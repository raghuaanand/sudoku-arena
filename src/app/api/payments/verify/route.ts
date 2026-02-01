import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { verifyPaymentSignature } from '@/lib/razorpay'
import { PaymentStatus, TransactionType, TransactionStatus } from '@prisma/client'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { orderId, paymentId, signature, paymentOrderId } = await request.json()

    if (!orderId || !paymentId || !signature) {
      return NextResponse.json({ error: 'Missing payment details' }, { status: 400 })
    }

    // Verify Razorpay signature
    const isValid = verifyPaymentSignature(orderId, paymentId, signature)

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
    }

    // Process the successful payment in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Get the pending payment order
      const paymentOrder = await tx.paymentOrder.findFirst({
        where: { 
          razorpayOrderId: orderId,
          userId: session.user.id,
          status: PaymentStatus.CREATED
        }
      })

      if (!paymentOrder) {
        throw new Error('Payment order not found or already processed')
      }

      // Update payment order status
      await tx.paymentOrder.update({
        where: { id: paymentOrder.id },
        data: {
          status: PaymentStatus.CAPTURED,
          razorpayPaymentId: paymentId,
          razorpaySignature: signature,
          paidAt: new Date(),
          verifiedAt: new Date()
        }
      })

      // Get or create wallet
      let wallet = await tx.wallet.findUnique({
        where: { userId: session.user.id }
      })

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: { userId: session.user.id }
        })
      }

      // Update wallet balance with optimistic locking
      const newBalance = wallet.balance + paymentOrder.amount
      const updated = await tx.wallet.updateMany({
        where: {
          userId: session.user.id,
          version: wallet.version
        },
        data: {
          balance: newBalance,
          totalDeposited: { increment: paymentOrder.amount },
          version: { increment: 1 }
        }
      })

      if (updated.count === 0) {
        throw new Error('Concurrent modification detected')
      }

      // Create transaction record
      const transaction = await tx.transaction.create({
        data: {
          userId: session.user.id,
          amount: paymentOrder.amount,
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.COMPLETED,
          paymentOrderId: paymentOrder.id,
          description: `Wallet recharge - ₹${paymentOrder.amount / 100}`,
          balanceBefore: wallet.balance,
          balanceAfter: newBalance
        }
      })

      return { 
        transaction, 
        newBalance,
        escrowBalance: wallet.escrowBalance
      }
    })

    return NextResponse.json({
      success: true,
      balance: result.newBalance,
      availableBalance: result.newBalance - result.escrowBalance,
      transaction: result.transaction
    })
  } catch (error) {
    console.error('Payment verification error:', error)
    
    if (error instanceof Error) {
      if (error.message === 'Payment order not found or already processed') {
        return NextResponse.json({ error: 'Payment order not found or already processed' }, { status: 404 })
      }
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
