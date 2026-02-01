import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateWebhookSignature, parseWebhookEvent } from '@/lib/razorpay'
import { PaymentStatus, TransactionType, TransactionStatus } from '@prisma/client'

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const signature = request.headers.get('x-razorpay-signature')
    
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    // Validate webhook signature
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.error('RAZORPAY_WEBHOOK_SECRET not configured')
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
    }

    // Skip signature validation for mock/development mode
    if (!webhookSecret.includes('mock')) {
      const isValid = validateWebhookSignature(body, signature, webhookSecret)
      if (!isValid) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
      }
    }

    const event = parseWebhookEvent(JSON.parse(body))

    // Handle different webhook events
    switch (event.type) {
      case 'payment_success':
        await handlePaymentSuccess(event.data)
        break
      
      case 'payment_failed':
        await handlePaymentFailed(event.data)
        break
      
      case 'refund_processed':
        await handleRefundProcessed(event.data)
        break
      
      default:
        console.log('Unhandled webhook event:', event.type)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Webhook processing error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function handlePaymentSuccess(paymentData: { order_id: string; id: string; amount: number }) {
  try {
    const orderId = paymentData.order_id
    const paymentId = paymentData.id
    const amount = paymentData.amount // Already in paisa

    // Find the payment order by Razorpay order ID
    const paymentOrder = await prisma.paymentOrder.findFirst({
      where: {
        razorpayOrderId: orderId,
        status: PaymentStatus.CREATED
      }
    })

    if (!paymentOrder) {
      console.error('Payment order not found for order:', orderId)
      return
    }

    // Update payment order and wallet in a database transaction
    await prisma.$transaction(async (tx) => {
      // Update payment order status
      await tx.paymentOrder.update({
        where: { id: paymentOrder.id },
        data: {
          status: PaymentStatus.CAPTURED,
          razorpayPaymentId: paymentId,
          paidAt: new Date(),
          verifiedAt: new Date()
        }
      })

      // Get or create wallet
      let wallet = await tx.wallet.findUnique({
        where: { userId: paymentOrder.userId }
      })

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: { userId: paymentOrder.userId }
        })
      }

      // Update wallet with optimistic locking
      const newBalance = wallet.balance + amount
      await tx.wallet.updateMany({
        where: {
          userId: paymentOrder.userId,
          version: wallet.version
        },
        data: {
          balance: newBalance,
          totalDeposited: { increment: amount },
          version: { increment: 1 }
        }
      })

      // Create transaction record
      await tx.transaction.create({
        data: {
          userId: paymentOrder.userId,
          amount: amount,
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.COMPLETED,
          paymentOrderId: paymentOrder.id,
          description: `Wallet recharge - ₹${amount / 100}`,
          balanceBefore: wallet.balance,
          balanceAfter: newBalance
        }
      })
    })

    console.log(`Payment successful for user ${paymentOrder.userId}, amount: ₹${amount / 100}`)
  } catch (error) {
    console.error('Error handling payment success:', error)
  }
}

async function handlePaymentFailed(paymentData: { order_id: string; error_description?: string }) {
  try {
    const orderId = paymentData.order_id

    // Find and update the payment order
    await prisma.paymentOrder.updateMany({
      where: {
        razorpayOrderId: orderId,
        status: PaymentStatus.CREATED
      },
      data: {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
        errorMessage: paymentData.error_description || 'Payment failed'
      }
    })

    console.log('Payment failed for order:', orderId)
  } catch (error) {
    console.error('Error handling payment failure:', error)
  }
}

async function handleRefundProcessed(refundData: { payment_id: string; id: string; amount: number }) {
  try {
    const paymentId = refundData.payment_id
    const refundAmount = refundData.amount // in paisa

    // Find the original payment order
    const paymentOrder = await prisma.paymentOrder.findFirst({
      where: {
        razorpayPaymentId: paymentId,
        status: PaymentStatus.CAPTURED
      }
    })

    if (!paymentOrder) {
      console.error('Payment order not found for refund:', paymentId)
      return
    }

    // Create refund transaction and update wallet
    await prisma.$transaction(async (tx) => {
      // Update payment order status
      await tx.paymentOrder.update({
        where: { id: paymentOrder.id },
        data: {
          status: PaymentStatus.REFUNDED,
          refundedAt: new Date()
        }
      })

      // Get wallet
      const wallet = await tx.wallet.findUnique({
        where: { userId: paymentOrder.userId }
      })

      if (!wallet) {
        throw new Error('Wallet not found for refund')
      }

      // Deduct refund amount from wallet
      const newBalance = wallet.balance - refundAmount
      await tx.wallet.updateMany({
        where: {
          userId: paymentOrder.userId,
          version: wallet.version
        },
        data: {
          balance: newBalance,
          totalDeposited: { decrement: refundAmount },
          version: { increment: 1 }
        }
      })

      // Create refund transaction record
      await tx.transaction.create({
        data: {
          userId: paymentOrder.userId,
          amount: -refundAmount,
          type: TransactionType.REFUND,
          description: `Refund for payment ${paymentOrder.id}`,
          status: TransactionStatus.COMPLETED,
          paymentOrderId: paymentOrder.id,
          referenceId: refundData.id,
          balanceBefore: wallet.balance,
          balanceAfter: newBalance
        }
      })
    })

    console.log(`Refund processed for user ${paymentOrder.userId}, amount: ₹${refundAmount / 100}`)
  } catch (error) {
    console.error('Error handling refund:', error)
  }
}

