/**
 * Wallet API - Enhanced with new wallet service
 * 
 * GET /api/wallet/v2 - Get wallet balance and stats
 * POST /api/wallet/v2 - Create deposit order
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { 
  getWalletBalance, 
  getOrCreateWallet,
  getTransactionHistory 
} from '@/lib/payments/escrowService'
import { createPaymentOrder } from '@/lib/payments/razorpayService'
import { PaymentPurpose } from '@prisma/client'
import { logger } from '@/lib/services/logger'

// Get wallet balance and recent transactions
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = session.user.id

    // Get wallet balance
    const balance = await getWalletBalance(userId)
    
    // Get wallet stats
    const wallet = await getOrCreateWallet(userId)

    // Get recent transactions
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')
    
    const transactions = await getTransactionHistory(userId, limit, offset)

    return NextResponse.json({
      balance: balance.balance / 100, // Convert to rupees for display
      escrowBalance: balance.escrowBalance / 100,
      availableBalance: balance.availableBalance / 100,
      stats: {
        totalDeposited: wallet.totalDeposited / 100,
        totalWithdrawn: wallet.totalWithdrawn / 100,
        totalWon: wallet.totalWon / 100,
        totalLost: wallet.totalLost / 100,
      },
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount / 100, // Convert to rupees
        status: t.status,
        description: t.description,
        createdAt: t.createdAt,
        matchId: t.matchId,
      })),
    })
  } catch (error) {
    logger.error('Wallet get failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'Failed to get wallet' },
      { status: 500 }
    )
  }
}

// Create a deposit order
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { amount } = body // Amount in rupees from client

    // Validate amount
    if (!amount || typeof amount !== 'number' || amount < 10) {
      return NextResponse.json(
        { error: 'Minimum deposit is ₹10' },
        { status: 400 }
      )
    }

    if (amount > 10000) {
      return NextResponse.json(
        { error: 'Maximum deposit is ₹10,000' },
        { status: 400 }
      )
    }

    // Convert to paisa
    const amountInPaisa = Math.round(amount * 100)

    // Generate idempotency key
    const idempotencyKey = `deposit_${session.user.id}_${Date.now()}`

    // Create Razorpay order
    const order = await createPaymentOrder({
      userId: session.user.id,
      amount: amountInPaisa,
      purpose: PaymentPurpose.WALLET_DEPOSIT,
      idempotencyKey,
    })

    logger.info('Deposit order created', {
      userId: session.user.id,
      amount: amountInPaisa,
      orderId: order.orderId,
    })

    return NextResponse.json({
      orderId: order.orderId,
      razorpayOrderId: order.razorpayOrderId,
      amount: order.amount,
      currency: order.currency,
      keyId: order.keyId,
    })
  } catch (error) {
    logger.error('Deposit order creation failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'Failed to create deposit order' },
      { status: 500 }
    )
  }
}
