/**
 * Payment Verification API
 * 
 * POST /api/payments/verify - Verify a payment after Razorpay checkout
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { verifyPayment, getPaymentOrder } from '@/lib/payments/razorpayService'
import { logger } from '@/lib/services/logger'

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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { error: 'Missing payment details' },
        { status: 400 }
      )
    }

    // Verify the payment
    const result = await verifyPayment({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    })

    if (!result.success) {
      logger.error('Payment verification failed', {
        userId: session.user.id,
        razorpayOrderId: razorpay_order_id,
        error: result.error,
      })
      return NextResponse.json(
        { error: result.error || 'Payment verification failed' },
        { status: 400 }
      )
    }

    // Get the order to return updated status
    const order = result.paymentOrderId 
      ? await getPaymentOrder(result.paymentOrderId)
      : null

    logger.info('Payment verified successfully', {
      userId: session.user.id,
      orderId: result.paymentOrderId,
      razorpayPaymentId: razorpay_payment_id,
    })

    return NextResponse.json({
      success: true,
      orderId: result.paymentOrderId,
      purpose: order?.purpose,
      amount: order?.amount ? order.amount / 100 : undefined, // Convert to rupees
    })
  } catch (error) {
    logger.error('Payment verification error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'Payment verification failed' },
      { status: 500 }
    )
  }
}
