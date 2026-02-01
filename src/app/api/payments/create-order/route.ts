import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createRazorpayOrder } from '@/lib/razorpay'
import { PaymentPurpose, PaymentStatus } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { amount } = await request.json()

    if (!amount || amount < 1) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    // Convert rupees to paisa
    const amountInPaisa = Math.round(amount * 100)
    
    // Generate idempotency key
    const idempotencyKey = `wallet_deposit_${session.user.id}_${uuidv4()}`

    // Create Razorpay order
    const order = await createRazorpayOrder(amountInPaisa, session.user.id, `Wallet recharge - ₹${amount}`)

    // Save payment order
    const paymentOrder = await prisma.paymentOrder.create({
      data: {
        userId: session.user.id,
        razorpayOrderId: order.id,
        amount: amountInPaisa,
        currency: 'INR',
        status: PaymentStatus.CREATED,
        purpose: PaymentPurpose.WALLET_DEPOSIT,
        idempotencyKey
      }
    })

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      paymentOrderId: paymentOrder.id,
      razorpayKey: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_mock_key'
    })
  } catch (error) {
    console.error('Payment initiation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
