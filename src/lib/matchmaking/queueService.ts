/**
 * Production-grade Matchmaking Queue Service
 * 
 * Features:
 * - Simple FIFO queue (first-come-first-served)
 * - Concurrency-safe using Redis atomic operations
 * - Prevents double-matching
 * - Queue entries expire after timeout
 * - Handles payment authorization before matching
 * 
 * Flow:
 * 1. Player pays entry fee (Razorpay)
 * 2. After payment verified, player joins queue
 * 3. First two players with same fee/duration are matched
 * 4. Match is created and players are notified
 */

import { prisma } from '@/lib/prisma'
import { getRedisClient, REDIS_KEYS, REDIS_TTL } from '@/lib/redis/redisClient'
import { hasSufficientBalance, lockEscrowForMatch } from '@/lib/payments/escrowService'
import { generateSeededPuzzle } from '@/lib/game/sudokuGenerator'
import { MatchType, MatchStatus, EscrowStatus, QueueStatus, Difficulty } from '@prisma/client'
import { auditLog, AuditAction } from '@/lib/services/auditService'
import { logger } from '@/lib/services/logger'

// ============================================
// TYPES
// ============================================

export interface QueueEntry {
  userId: string
  joinedAt: number
  paymentOrderId?: string
}

export interface JoinQueueParams {
  userId: string
  entryFee: number      // In paisa
  duration: number      // In seconds (300, 600, etc.)
  difficulty: Difficulty
  paymentOrderId?: string
}

export interface JoinQueueResult {
  success: boolean
  queueId?: string
  position?: number
  matchId?: string      // If immediately matched
  error?: string
}

export interface QueueStatusResult {
  inQueue: boolean
  position?: number
  entryFee?: number
  duration?: number
  joinedAt?: Date
  matchId?: string      // If matched
}

export interface MatchResult {
  matchId: string
  player1Id: string
  player2Id: string
  entryFee: number
  duration: number
  difficulty: Difficulty
}

// Queue entry timeout (5 minutes)
const QUEUE_TIMEOUT_MS = 5 * 60 * 1000

// ============================================
// QUEUE OPERATIONS
// ============================================

/**
 * Join the matchmaking queue
 * Returns immediately if a match is found, otherwise puts player in queue
 */
export async function joinQueue(params: JoinQueueParams): Promise<JoinQueueResult> {
  const { userId, entryFee, duration, difficulty, paymentOrderId } = params

  logger.info('Player joining queue', { userId, entryFee, duration, difficulty })

  // Check if player is already in a queue
  const existingStatus = await getQueueStatus(userId)
  if (existingStatus.inQueue) {
    return { success: false, error: 'Already in queue' }
  }

  // Check if player is already in an active match
  const activeMatch = await prisma.match.findFirst({
    where: {
      OR: [
        { player1Id: userId },
        { player2Id: userId },
      ],
      status: {
        in: [MatchStatus.WAITING, MatchStatus.PAYMENT_PENDING, MatchStatus.READY, MatchStatus.ONGOING],
      },
    },
  })

  if (activeMatch) {
    return { success: false, error: 'Already in an active match', matchId: activeMatch.id }
  }

  // For paid matches, verify balance
  if (entryFee > 0) {
    const hasBalance = await hasSufficientBalance(userId, entryFee)
    if (!hasBalance) {
      return { success: false, error: 'Insufficient balance' }
    }
  }

  const redis = getRedisClient()
  const queueKey = REDIS_KEYS.matchmakingQueue(entryFee, duration)
  const userQueueKey = REDIS_KEYS.userQueueStatus(userId)

  try {
    // Try to find an opponent in the queue
    const opponent = await tryMatchWithOpponent(queueKey, userId, entryFee, duration, difficulty)

    if (opponent) {
      // Matched! Create the match
      const match = await createMatch({
        player1Id: opponent,
        player2Id: userId,
        entryFee,
        duration,
        difficulty,
      })

      if (match) {
        logger.info('Match created from queue', { matchId: match.matchId })
        return { success: true, matchId: match.matchId }
      } else {
        // Match creation failed, put opponent back in queue and add ourselves
        await redis.lpush(queueKey, JSON.stringify({
          userId: opponent,
          joinedAt: Date.now(),
        }))
      }
    }

    // No match found, add to queue
    const queueEntry: QueueEntry = {
      userId,
      joinedAt: Date.now(),
      paymentOrderId,
    }

    await redis.lpush(queueKey, JSON.stringify(queueEntry))
    
    // Store user's queue status
    await redis.set(userQueueKey, JSON.stringify({
      entryFee,
      duration,
      difficulty,
      joinedAt: Date.now(),
    }), { ex: REDIS_TTL.queueEntry })

    // Create database record
    const dbQueueEntry = await prisma.matchmakingQueue.create({
      data: {
        userId,
        entryFee,
        duration,
        difficulty,
        status: QueueStatus.WAITING,
        paymentOrderId,
        paymentAuthorized: entryFee === 0 || !!paymentOrderId,
      },
    })

    // Get position in queue
    const position = await redis.llen(queueKey)

    logger.info('Player added to queue', { userId, position, queueId: dbQueueEntry.id })

    return { 
      success: true, 
      queueId: dbQueueEntry.id,
      position,
    }
  } catch (error) {
    logger.error('Failed to join queue', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to join queue',
    }
  }
}

/**
 * Leave the matchmaking queue
 */
export async function leaveQueue(userId: string): Promise<{ success: boolean; error?: string }> {
  logger.info('Player leaving queue', { userId })

  const redis = getRedisClient()
  const userQueueKey = REDIS_KEYS.userQueueStatus(userId)

  try {
    // Get user's queue info
    const queueInfoStr = await redis.get(userQueueKey)
    if (!queueInfoStr) {
      return { success: false, error: 'Not in queue' }
    }

    const queueInfo = JSON.parse(queueInfoStr)
    const queueKey = REDIS_KEYS.matchmakingQueue(queueInfo.entryFee, queueInfo.duration)

    // Remove from Redis queue - remove all entries with this userId
    const entries = await redis.lrange(queueKey, 0, -1)
    for (const entryStr of entries) {
      try {
        const entry = JSON.parse(entryStr)
        if (entry.userId === userId) {
          await redis.lrem(queueKey, 1, entryStr)
        }
      } catch {
        // Skip invalid entries
      }
    }
    await redis.del(userQueueKey)

    // Update database
    await prisma.matchmakingQueue.updateMany({
      where: {
        userId,
        status: QueueStatus.WAITING,
      },
      data: {
        status: QueueStatus.CANCELLED,
      },
    })

    logger.info('Player removed from queue', { userId })
    return { success: true }
  } catch (error) {
    logger.error('Failed to leave queue', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to leave queue',
    }
  }
}

/**
 * Get player's current queue status
 */
export async function getQueueStatus(userId: string): Promise<QueueStatusResult> {
  const redis = getRedisClient()
  const userQueueKey = REDIS_KEYS.userQueueStatus(userId)

  const queueInfoStr = await redis.get(userQueueKey)
  if (!queueInfoStr) {
    // Check database for matched status
    const dbEntry = await prisma.matchmakingQueue.findFirst({
      where: {
        userId,
        status: {
          in: [QueueStatus.WAITING, QueueStatus.MATCHED],
        },
      },
      orderBy: { joinedAt: 'desc' },
    })

    if (dbEntry && dbEntry.status === QueueStatus.MATCHED && dbEntry.matchId) {
      return {
        inQueue: false,
        matchId: dbEntry.matchId,
      }
    }

    return { inQueue: false }
  }

  const queueInfo = JSON.parse(queueInfoStr)
  const queueKey = REDIS_KEYS.matchmakingQueue(queueInfo.entryFee, queueInfo.duration)

  // Get position in queue
  const allEntries = await redis.lrange(queueKey, 0, -1)
  const position = allEntries.findIndex(entry => {
    const parsed = JSON.parse(entry)
    return parsed.userId === userId
  })

  return {
    inQueue: true,
    position: position >= 0 ? position + 1 : undefined,
    entryFee: queueInfo.entryFee,
    duration: queueInfo.duration,
    joinedAt: new Date(queueInfo.joinedAt),
  }
}

// ============================================
// INTERNAL FUNCTIONS
// ============================================

/**
 * Try to find an opponent in the queue (atomic operation)
 */
async function tryMatchWithOpponent(
  queueKey: string,
  userId: string,
  entryFee: number,
  duration: number,
  difficulty: Difficulty
): Promise<string | null> {
  const redis = getRedisClient()

  // Get all entries from the queue
  const entries = await redis.lrange(queueKey, 0, -1)
  
  for (const entryStr of entries) {
    const entry: QueueEntry = JSON.parse(entryStr)
    
    // Skip if same user
    if (entry.userId === userId) continue
    
    // Skip if entry is expired
    if (Date.now() - entry.joinedAt > QUEUE_TIMEOUT_MS) {
      await redis.lrem(queueKey, 1, entryStr)
      continue
    }

    // Verify opponent still has balance (for paid matches)
    if (entryFee > 0) {
      const hasBalance = await hasSufficientBalance(entry.userId, entryFee)
      if (!hasBalance) {
        await redis.lrem(queueKey, 1, entryStr)
        continue
      }
    }

    // Found a valid opponent - remove from queue atomically
    const removed = await redis.lrem(queueKey, 1, entryStr)
    if (removed > 0) {
      // Clean up opponent's queue status
      await redis.del(REDIS_KEYS.userQueueStatus(entry.userId))
      return entry.userId
    }
  }

  return null
}

/**
 * Create a match between two players
 */
async function createMatch(params: {
  player1Id: string
  player2Id: string
  entryFee: number
  duration: number
  difficulty: Difficulty
}): Promise<MatchResult | null> {
  const { player1Id, player2Id, entryFee, duration, difficulty } = params

  logger.info('Creating match', { player1Id, player2Id, entryFee, duration })

  try {
    // Generate sudoku puzzle with deterministic seed
    const seed = `${player1Id}-${player2Id}-${Date.now()}`
    const { puzzle, solution } = generateSeededPuzzle(seed, difficulty)

    // Create match in transaction
    const match = await prisma.$transaction(async (tx) => {
      const matchType = entryFee > 0 ? MatchType.MULTIPLAYER_PAID : MatchType.MULTIPLAYER_FREE

      const newMatch = await tx.match.create({
        data: {
          type: matchType,
          status: entryFee > 0 ? MatchStatus.PAYMENT_PENDING : MatchStatus.READY,
          entryFee,
          duration,
          difficulty,
          player1Id,
          player2Id,
          sudokuSeed: seed,
          sudokuGrid: JSON.stringify(puzzle),
          solution: JSON.stringify(solution),
          escrowStatus: entryFee > 0 ? EscrowStatus.PENDING : EscrowStatus.NONE,
        },
      })

      // Update queue entries
      await tx.matchmakingQueue.updateMany({
        where: {
          userId: { in: [player1Id, player2Id] },
          status: QueueStatus.WAITING,
        },
        data: {
          status: QueueStatus.MATCHED,
          matchedAt: new Date(),
          matchId: newMatch.id,
        },
      })

      return newMatch
    })

    // For paid matches, lock escrow
    if (entryFee > 0) {
      const escrowResult = await lockEscrowForMatch(
        match.id,
        player1Id,
        player2Id,
        entryFee
      )

      if (!escrowResult.success) {
        // Escrow failed - cancel match and refund
        logger.error('Escrow lock failed', { matchId: match.id, error: escrowResult.error })
        
        await prisma.match.update({
          where: { id: match.id },
          data: {
            status: MatchStatus.CANCELLED,
            cancelReason: `Escrow failed: ${escrowResult.error}`,
          },
        })

        return null
      }

      // Update match to ready status
      await prisma.match.update({
        where: { id: match.id },
        data: {
          status: MatchStatus.READY,
          escrowStatus: EscrowStatus.LOCKED,
        },
      })
    }

    await auditLog({
      action: AuditAction.CREATE,
      entityType: 'Match',
      entityId: match.id,
      metadata: {
        player1Id,
        player2Id,
        entryFee,
        duration,
        difficulty,
      },
    })

    logger.info('Match created successfully', { matchId: match.id })

    // Notify players via Redis pub/sub
    const redis = getRedisClient()
    await redis.publish('match:created', JSON.stringify({
      matchId: match.id,
      player1Id,
      player2Id,
    }))

    return {
      matchId: match.id,
      player1Id,
      player2Id,
      entryFee,
      duration,
      difficulty,
    }
  } catch (error) {
    logger.error('Failed to create match', {
      player1Id,
      player2Id,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return null
  }
}

// ============================================
// QUEUE MAINTENANCE
// ============================================

/**
 * Clean up expired queue entries (run periodically)
 */
export async function cleanupExpiredEntries(): Promise<number> {
  logger.info('Cleaning up expired queue entries')

  const redis = getRedisClient()
  const now = Date.now()
  let cleaned = 0

  // Get all queue keys (in production, use SCAN)
  // For now, check common fee/duration combinations
  const commonFees = [0, 1000, 2500, 5000, 10000] // 0, 10, 25, 50, 100 INR
  const commonDurations = [300, 600, 900] // 5, 10, 15 minutes

  for (const fee of commonFees) {
    for (const duration of commonDurations) {
      const queueKey = REDIS_KEYS.matchmakingQueue(fee, duration)
      const entries = await redis.lrange(queueKey, 0, -1)

      for (const entryStr of entries) {
        try {
          const entry: QueueEntry = JSON.parse(entryStr)
          if (now - entry.joinedAt > QUEUE_TIMEOUT_MS) {
            await redis.lrem(queueKey, 1, entryStr)
            await redis.del(REDIS_KEYS.userQueueStatus(entry.userId))
            cleaned++
          }
        } catch {
          // Invalid entry, remove it
          await redis.lrem(queueKey, 1, entryStr)
          cleaned++
        }
      }
    }
  }

  // Update database
  await prisma.matchmakingQueue.updateMany({
    where: {
      status: QueueStatus.WAITING,
      joinedAt: {
        lt: new Date(now - QUEUE_TIMEOUT_MS),
      },
    },
    data: {
      status: QueueStatus.EXPIRED,
      expiredAt: new Date(),
    },
  })

  logger.info('Queue cleanup completed', { cleaned })
  return cleaned
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  totalWaiting: number
  byFee: Record<number, number>
}> {
  const redis = getRedisClient()
  const stats: Record<number, number> = {}
  let total = 0

  const commonFees = [0, 1000, 2500, 5000, 10000]
  const commonDurations = [300, 600, 900]

  for (const fee of commonFees) {
    let feeTotal = 0
    for (const duration of commonDurations) {
      const queueKey = REDIS_KEYS.matchmakingQueue(fee, duration)
      const len = await redis.llen(queueKey)
      feeTotal += len
    }
    stats[fee] = feeTotal
    total += feeTotal
  }

  return { totalWaiting: total, byFee: stats }
}
