/**
 * Production-grade Wallet and Escrow Service
 * 
 * Handles all money movements for the platform:
 * - Wallet balance management
 * - Escrow locking for matches
 * - Payout distribution to winners
 * - Refund processing
 * 
 * Security & Reliability:
 * - All operations use database transactions
 * - Optimistic locking prevents race conditions
 * - Balance snapshots for reconciliation
 * - Full audit trail
 */

import { prisma } from '@/lib/prisma'
import { 
  TransactionType, 
  TransactionStatus, 
  EscrowStatus,
  MatchStatus,
  Prisma
} from '@prisma/client'
import { auditLog, AuditAction, createBatchAuditLogger } from '@/lib/services/auditService'
import { logger } from '@/lib/services/logger'

// Platform fee percentage (10%)
const PLATFORM_FEE_PERCENT = 10

// ============================================
// TYPES
// ============================================

export interface WalletBalance {
  balance: number
  escrowBalance: number
  availableBalance: number
}

export interface EscrowResult {
  success: boolean
  error?: string
  transactionId?: string
}

export interface PayoutResult {
  success: boolean
  error?: string
  winnerPayout?: number
  platformFee?: number
}

// ============================================
// WALLET OPERATIONS
// ============================================

/**
 * Get or create a wallet for a user
 */
export async function getOrCreateWallet(userId: string) {
  let wallet = await prisma.wallet.findUnique({
    where: { userId },
  })

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId },
    })
    
    await auditLog({
      userId,
      action: AuditAction.CREATE,
      entityType: 'Wallet',
      entityId: wallet.id,
      after: { balance: 0, escrowBalance: 0 },
    })
  }

  return wallet
}

/**
 * Get wallet balance with available (non-escrowed) amount
 */
export async function getWalletBalance(userId: string): Promise<WalletBalance> {
  const wallet = await getOrCreateWallet(userId)
  
  return {
    balance: wallet.balance,
    escrowBalance: wallet.escrowBalance,
    availableBalance: wallet.balance - wallet.escrowBalance,
  }
}

/**
 * Check if user has sufficient balance for an entry fee
 */
export async function hasSufficientBalance(
  userId: string,
  amount: number
): Promise<boolean> {
  const { availableBalance } = await getWalletBalance(userId)
  return availableBalance >= amount
}

/**
 * Credit wallet (used after successful deposit)
 */
export async function creditWallet(
  userId: string,
  amount: number,
  type: TransactionType,
  description: string,
  referenceId?: string
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  if (amount <= 0) {
    return { success: false, error: 'Amount must be positive' }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId },
      })

      if (!wallet) {
        throw new Error('Wallet not found')
      }

      const balanceBefore = wallet.balance
      const balanceAfter = balanceBefore + amount

      // Update wallet with optimistic locking
      const updated = await tx.wallet.updateMany({
        where: {
          userId,
          version: wallet.version,
        },
        data: {
          balance: balanceAfter,
          totalDeposited: type === TransactionType.DEPOSIT 
            ? { increment: amount } 
            : undefined,
          totalWon: type === TransactionType.MATCH_WIN 
            ? { increment: amount } 
            : undefined,
          version: { increment: 1 },
        },
      })

      if (updated.count === 0) {
        throw new Error('Concurrent modification detected, please retry')
      }

      // Create transaction record
      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount,
          type,
          status: TransactionStatus.COMPLETED,
          referenceId,
          balanceBefore,
          balanceAfter,
          description,
        },
      })

      return transaction
    })

    await auditLog({
      userId,
      action: AuditAction.UPDATE,
      entityType: 'Wallet',
      entityId: userId,
      metadata: { type, amount, transactionId: result.id },
    })

    logger.info('Wallet credited', {
      userId,
      amount,
      type,
      transactionId: result.id,
    })

    return { success: true, transactionId: result.id }
  } catch (error) {
    logger.error('Failed to credit wallet', {
      userId,
      amount,
      type,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to credit wallet',
    }
  }
}

/**
 * Debit wallet (used for entry fees, withdrawals)
 */
export async function debitWallet(
  userId: string,
  amount: number,
  type: TransactionType,
  description: string,
  referenceId?: string
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  if (amount <= 0) {
    return { success: false, error: 'Amount must be positive' }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId },
      })

      if (!wallet) {
        throw new Error('Wallet not found')
      }

      const availableBalance = wallet.balance - wallet.escrowBalance
      if (availableBalance < amount) {
        throw new Error('Insufficient balance')
      }

      const balanceBefore = wallet.balance
      const balanceAfter = balanceBefore - amount

      // Update wallet with optimistic locking
      const updated = await tx.wallet.updateMany({
        where: {
          userId,
          version: wallet.version,
        },
        data: {
          balance: balanceAfter,
          totalWithdrawn: type === TransactionType.WITHDRAWAL 
            ? { increment: amount } 
            : undefined,
          totalLost: type === TransactionType.ENTRY_FEE 
            ? { increment: amount } 
            : undefined,
          version: { increment: 1 },
        },
      })

      if (updated.count === 0) {
        throw new Error('Concurrent modification detected, please retry')
      }

      // Create transaction record
      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount: -amount, // Negative for debits
          type,
          status: TransactionStatus.COMPLETED,
          referenceId,
          balanceBefore,
          balanceAfter,
          description,
        },
      })

      return transaction
    })

    logger.info('Wallet debited', {
      userId,
      amount,
      type,
      transactionId: result.id,
    })

    return { success: true, transactionId: result.id }
  } catch (error) {
    logger.error('Failed to debit wallet', {
      userId,
      amount,
      type,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to debit wallet',
    }
  }
}

// ============================================
// ESCROW OPERATIONS
// ============================================

/**
 * Lock funds in escrow for a match
 * Called when both players are matched and confirm entry
 */
export async function lockEscrowForMatch(
  matchId: string,
  player1Id: string,
  player2Id: string,
  entryFeePerPlayer: number
): Promise<EscrowResult> {
  const totalEscrow = entryFeePerPlayer * 2
  const platformFee = Math.floor(totalEscrow * PLATFORM_FEE_PERCENT / 100)
  const prizePool = totalEscrow - platformFee

  logger.info('Locking escrow for match', {
    matchId,
    player1Id,
    player2Id,
    entryFeePerPlayer,
    totalEscrow,
    platformFee,
    prizePool,
  })

  try {
    await prisma.$transaction(async (tx) => {
      // Get both wallets
      const [wallet1, wallet2] = await Promise.all([
        tx.wallet.findUnique({ where: { userId: player1Id } }),
        tx.wallet.findUnique({ where: { userId: player2Id } }),
      ])

      if (!wallet1 || !wallet2) {
        throw new Error('One or both player wallets not found')
      }

      // Check sufficient balance for both
      const available1 = wallet1.balance - wallet1.escrowBalance
      const available2 = wallet2.balance - wallet2.escrowBalance

      if (available1 < entryFeePerPlayer) {
        throw new Error(`Player 1 has insufficient balance: ${available1} < ${entryFeePerPlayer}`)
      }
      if (available2 < entryFeePerPlayer) {
        throw new Error(`Player 2 has insufficient balance: ${available2} < ${entryFeePerPlayer}`)
      }

      // Lock escrow for player 1
      const update1 = await tx.wallet.updateMany({
        where: { userId: player1Id, version: wallet1.version },
        data: {
          escrowBalance: { increment: entryFeePerPlayer },
          version: { increment: 1 },
        },
      })

      if (update1.count === 0) {
        throw new Error('Failed to lock escrow for player 1 (concurrent modification)')
      }

      // Lock escrow for player 2
      const update2 = await tx.wallet.updateMany({
        where: { userId: player2Id, version: wallet2.version },
        data: {
          escrowBalance: { increment: entryFeePerPlayer },
          version: { increment: 1 },
        },
      })

      if (update2.count === 0) {
        // Rollback player 1's escrow
        await tx.wallet.update({
          where: { userId: player1Id },
          data: {
            escrowBalance: { decrement: entryFeePerPlayer },
          },
        })
        throw new Error('Failed to lock escrow for player 2 (concurrent modification)')
      }

      // Create escrow lock transactions
      const p1BalanceBefore = wallet1.balance
      const p2BalanceBefore = wallet2.balance

      await tx.transaction.createMany({
        data: [
          {
            userId: player1Id,
            amount: -entryFeePerPlayer,
            type: TransactionType.ESCROW_LOCK,
            matchId,
            balanceBefore: p1BalanceBefore,
            balanceAfter: p1BalanceBefore, // Balance doesn't change, only escrow
            description: `Entry fee locked for match ${matchId}`,
          },
          {
            userId: player2Id,
            amount: -entryFeePerPlayer,
            type: TransactionType.ESCROW_LOCK,
            matchId,
            balanceBefore: p2BalanceBefore,
            balanceAfter: p2BalanceBefore,
            description: `Entry fee locked for match ${matchId}`,
          },
        ],
      })

      // Update match with escrow info
      await tx.match.update({
        where: { id: matchId },
        data: {
          escrowStatus: EscrowStatus.LOCKED,
          escrowLocked: totalEscrow,
          platformFee,
          prizePool,
        },
      })
    })

    const auditLogger = createBatchAuditLogger()
    auditLogger.add({
      userId: player1Id,
      action: AuditAction.ESCROW_LOCKED,
      entityType: 'Match',
      entityId: matchId,
      metadata: { amount: entryFeePerPlayer, role: 'player1' },
    })
    auditLogger.add({
      userId: player2Id,
      action: AuditAction.ESCROW_LOCKED,
      entityType: 'Match',
      entityId: matchId,
      metadata: { amount: entryFeePerPlayer, role: 'player2' },
    })
    await auditLogger.flush()

    logger.info('Escrow locked successfully', { matchId, totalEscrow })

    return { success: true }
  } catch (error) {
    logger.error('Failed to lock escrow', {
      matchId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to lock escrow',
    }
  }
}

/**
 * Release escrow and pay winner
 * Called when match ends normally
 */
export async function releaseEscrowToWinner(
  matchId: string,
  winnerId: string,
  loserId: string
): Promise<PayoutResult> {
  logger.info('Releasing escrow to winner', { matchId, winnerId, loserId })

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Get match details
      const match = await tx.match.findUnique({
        where: { id: matchId },
      })

      if (!match) {
        throw new Error('Match not found')
      }

      if (match.escrowStatus !== EscrowStatus.LOCKED) {
        throw new Error(`Invalid escrow status: ${match.escrowStatus}`)
      }

      const entryFeePerPlayer = match.entryFee
      const prizePool = match.prizePool
      const platformFee = match.platformFee

      // Get wallets
      const [winnerWallet, loserWallet] = await Promise.all([
        tx.wallet.findUnique({ where: { userId: winnerId } }),
        tx.wallet.findUnique({ where: { userId: loserId } }),
      ])

      if (!winnerWallet || !loserWallet) {
        throw new Error('Winner or loser wallet not found')
      }

      // Release escrow for both players (deduct from escrowBalance)
      await tx.wallet.update({
        where: { userId: winnerId },
        data: {
          escrowBalance: { decrement: entryFeePerPlayer },
          // Winner: entry fee is converted to loss, then gets prize
          balance: { increment: prizePool - entryFeePerPlayer },
          totalWon: { increment: prizePool },
          totalLost: { increment: entryFeePerPlayer },
          version: { increment: 1 },
        },
      })

      await tx.wallet.update({
        where: { userId: loserId },
        data: {
          escrowBalance: { decrement: entryFeePerPlayer },
          balance: { decrement: entryFeePerPlayer },
          totalLost: { increment: entryFeePerPlayer },
          version: { increment: 1 },
        },
      })

      // Create transaction records
      await tx.transaction.createMany({
        data: [
          // Winner entry fee deduction
          {
            userId: winnerId,
            amount: -entryFeePerPlayer,
            type: TransactionType.ENTRY_FEE,
            matchId,
            balanceBefore: winnerWallet.balance,
            balanceAfter: winnerWallet.balance - entryFeePerPlayer,
            description: `Entry fee for match ${matchId}`,
          },
          // Winner prize credit
          {
            userId: winnerId,
            amount: prizePool,
            type: TransactionType.MATCH_WIN,
            matchId,
            balanceBefore: winnerWallet.balance - entryFeePerPlayer,
            balanceAfter: winnerWallet.balance - entryFeePerPlayer + prizePool,
            description: `Won match ${matchId}`,
          },
          // Loser entry fee deduction
          {
            userId: loserId,
            amount: -entryFeePerPlayer,
            type: TransactionType.ENTRY_FEE,
            matchId,
            balanceBefore: loserWallet.balance,
            balanceAfter: loserWallet.balance - entryFeePerPlayer,
            description: `Entry fee for match ${matchId} (lost)`,
          },
        ],
      })

      // Update match status
      await tx.match.update({
        where: { id: matchId },
        data: {
          escrowStatus: EscrowStatus.RELEASED,
          winnerId,
          status: MatchStatus.FINISHED,
          endedAt: new Date(),
        },
      })

      return { prizePool, platformFee }
    })

    await auditLog({
      userId: winnerId,
      action: AuditAction.ESCROW_RELEASED,
      entityType: 'Match',
      entityId: matchId,
      metadata: {
        winnerId,
        loserId,
        prizePool: result.prizePool,
        platformFee: result.platformFee,
      },
    })

    logger.info('Escrow released successfully', {
      matchId,
      winnerId,
      prizePool: result.prizePool,
    })

    return {
      success: true,
      winnerPayout: result.prizePool,
      platformFee: result.platformFee,
    }
  } catch (error) {
    logger.error('Failed to release escrow', {
      matchId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to release escrow',
    }
  }
}

/**
 * Handle tie - split prize pool between both players
 */
export async function releaseEscrowTie(
  matchId: string,
  player1Id: string,
  player2Id: string
): Promise<PayoutResult> {
  logger.info('Releasing escrow for tie', { matchId, player1Id, player2Id })

  try {
    await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
      })

      if (!match || match.escrowStatus !== EscrowStatus.LOCKED) {
        throw new Error('Match not found or invalid escrow status')
      }

      const entryFeePerPlayer = match.entryFee
      const prizePool = match.prizePool
      const splitAmount = Math.floor(prizePool / 2)

      // Get wallets
      const [wallet1, wallet2] = await Promise.all([
        tx.wallet.findUnique({ where: { userId: player1Id } }),
        tx.wallet.findUnique({ where: { userId: player2Id } }),
      ])

      if (!wallet1 || !wallet2) {
        throw new Error('Player wallets not found')
      }

      // Each player gets back split amount minus their entry fee
      const netChange = splitAmount - entryFeePerPlayer

      // Update both wallets
      await tx.wallet.update({
        where: { userId: player1Id },
        data: {
          escrowBalance: { decrement: entryFeePerPlayer },
          balance: { increment: netChange },
          version: { increment: 1 },
        },
      })

      await tx.wallet.update({
        where: { userId: player2Id },
        data: {
          escrowBalance: { decrement: entryFeePerPlayer },
          balance: { increment: netChange },
          version: { increment: 1 },
        },
      })

      // Create transaction records
      await tx.transaction.createMany({
        data: [
          {
            userId: player1Id,
            amount: netChange,
            type: TransactionType.ESCROW_RELEASE,
            matchId,
            balanceBefore: wallet1.balance,
            balanceAfter: wallet1.balance + netChange,
            description: `Tie match ${matchId} - split prize`,
          },
          {
            userId: player2Id,
            amount: netChange,
            type: TransactionType.ESCROW_RELEASE,
            matchId,
            balanceBefore: wallet2.balance,
            balanceAfter: wallet2.balance + netChange,
            description: `Tie match ${matchId} - split prize`,
          },
        ],
      })

      // Update match
      await tx.match.update({
        where: { id: matchId },
        data: {
          escrowStatus: EscrowStatus.RELEASED,
          status: MatchStatus.FINISHED,
          endedAt: new Date(),
          // No winner for tie
        },
      })
    })

    logger.info('Escrow released for tie', { matchId })

    return { success: true }
  } catch (error) {
    logger.error('Failed to release escrow for tie', {
      matchId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to release escrow',
    }
  }
}

/**
 * Refund escrow when match is cancelled or fails to start
 */
export async function refundEscrow(
  matchId: string,
  reason: string
): Promise<EscrowResult> {
  logger.info('Refunding escrow', { matchId, reason })

  try {
    await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
      })

      if (!match) {
        throw new Error('Match not found')
      }

      if (match.escrowStatus !== EscrowStatus.LOCKED && match.escrowStatus !== EscrowStatus.PENDING) {
        throw new Error(`Cannot refund - escrow status: ${match.escrowStatus}`)
      }

      const entryFeePerPlayer = match.entryFee
      const player1Id = match.player1Id
      const player2Id = match.player2Id

      // Refund player 1
      const wallet1 = await tx.wallet.findUnique({ where: { userId: player1Id } })
      if (wallet1 && wallet1.escrowBalance >= entryFeePerPlayer) {
        await tx.wallet.update({
          where: { userId: player1Id },
          data: {
            escrowBalance: { decrement: entryFeePerPlayer },
            version: { increment: 1 },
          },
        })

        await tx.transaction.create({
          data: {
            userId: player1Id,
            amount: entryFeePerPlayer,
            type: TransactionType.REFUND,
            matchId,
            balanceBefore: wallet1.balance,
            balanceAfter: wallet1.balance,
            description: `Refund for cancelled match: ${reason}`,
          },
        })
      }

      // Refund player 2 if exists
      if (player2Id) {
        const wallet2 = await tx.wallet.findUnique({ where: { userId: player2Id } })
        if (wallet2 && wallet2.escrowBalance >= entryFeePerPlayer) {
          await tx.wallet.update({
            where: { userId: player2Id },
            data: {
              escrowBalance: { decrement: entryFeePerPlayer },
              version: { increment: 1 },
            },
          })

          await tx.transaction.create({
            data: {
              userId: player2Id,
              amount: entryFeePerPlayer,
              type: TransactionType.REFUND,
              matchId,
              balanceBefore: wallet2.balance,
              balanceAfter: wallet2.balance,
              description: `Refund for cancelled match: ${reason}`,
            },
          })
        }
      }

      // Update match
      await tx.match.update({
        where: { id: matchId },
        data: {
          escrowStatus: EscrowStatus.REFUNDED,
          status: MatchStatus.CANCELLED,
          cancelReason: reason,
          endedAt: new Date(),
        },
      })
    })

    await auditLog({
      action: AuditAction.REFUND_ISSUED,
      entityType: 'Match',
      entityId: matchId,
      metadata: { reason },
    })

    logger.info('Escrow refunded successfully', { matchId })

    return { success: true }
  } catch (error) {
    logger.error('Failed to refund escrow', {
      matchId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to refund escrow',
    }
  }
}

// ============================================
// UTILITIES
// ============================================

/**
 * Get transaction history for a user
 */
export async function getTransactionHistory(
  userId: string,
  limit = 50,
  offset = 0
) {
  return prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    include: {
      match: {
        select: {
          id: true,
          type: true,
          status: true,
          player1Id: true,
          player2Id: true,
          winnerId: true,
        },
      },
    },
  })
}

/**
 * Get total platform fees collected
 */
export async function getTotalPlatformFees(
  startDate?: Date,
  endDate?: Date
): Promise<number> {
  const result = await prisma.match.aggregate({
    _sum: {
      platformFee: true,
    },
    where: {
      escrowStatus: EscrowStatus.RELEASED,
      endedAt: {
        gte: startDate,
        lte: endDate,
      },
    },
  })

  return result._sum.platformFee || 0
}
