/**
 * Production-grade Razorpay payment service
 * 
 * Handles:
 * - Order creation with idempotency
 * - Webhook verification and processing
 * - Payment capture and verification
 * - Refund processing
 * 
 * Security considerations:
 * - All payment state changes are server-side only
 * - Webhook signatures are verified using HMAC-SHA256
 * - Idempotency keys prevent duplicate processing
 * - All amounts are in paisa (INR * 100)
 */

import Razorpay from 'razorpay'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { PaymentStatus, PaymentPurpose, TransactionType } from '@prisma/client'
import { auditLog, AuditAction } from '@/lib/services/auditService'
import { logger } from '@/lib/services/logger'

// Singleton Razorpay instance
let razorpayInstance: Razorpay | null = null

function getRazorpayInstance(): Razorpay {
  if (!razorpayInstance) {
    const keyId = process.env.RAZORPAY_KEY_ID
    const keySecret = process.env.RAZORPAY_KEY_SECRET

    if (!keyId || !keySecret) {
      throw new Error('Razorpay credentials not configured')
    }

    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    })
  }
  return razorpayInstance
}

// ============================================
// TYPES
// ============================================

export interface CreateOrderParams {
  userId: string
  amount: number // In paisa
  purpose: PaymentPurpose
  matchId?: string
  idempotencyKey: string
  metadata?: Record<string, string>
}

export interface CreateOrderResult {
  orderId: string
  razorpayOrderId: string
  amount: number
  currency: string
  keyId: string
}

export interface VerifyPaymentParams {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}

export interface WebhookEvent {
  event: string
  payload: {
    payment?: { entity: RazorpayPayment }
    order?: { entity: RazorpayOrder }
    refund?: { entity: RazorpayRefund }
  }
}

interface RazorpayPayment {
  id: string
  order_id: string
  amount: number
  currency: string
  status: string
  method: string
  email?: string
  contact?: string
  notes?: Record<string, string>
  error_code?: string
  error_description?: string
  created_at: number
}

interface RazorpayOrder {
  id: string
  amount: number
  currency: string
  status: string
  receipt?: string
  notes?: Record<string, string>
  created_at: number
}

interface RazorpayRefund {
  id: string
  payment_id: string
  amount: number
  currency: string
  status: string
  notes?: Record<string, string>
  created_at: number
}

// ============================================
// ORDER CREATION
// ============================================

/**
 * Create a Razorpay order with idempotency protection
 * Returns existing order if idempotencyKey was already used
 */
export async function createPaymentOrder(
  params: CreateOrderParams
): Promise<CreateOrderResult> {
  const { userId, amount, purpose, matchId, idempotencyKey, metadata } = params

  logger.info('Creating payment order', {
    userId,
    amount,
    purpose,
    idempotencyKey,
  })

  // Check for existing order with same idempotency key
  const existingOrder = await prisma.paymentOrder.findUnique({
    where: { idempotencyKey },
  })

  if (existingOrder) {
    logger.info('Returning existing order for idempotency key', {
      orderId: existingOrder.id,
      idempotencyKey,
    })

    return {
      orderId: existingOrder.id,
      razorpayOrderId: existingOrder.razorpayOrderId,
      amount: existingOrder.amount,
      currency: existingOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID!,
    }
  }

  // Create Razorpay order
  const razorpay = getRazorpayInstance()
  const receipt = `rcpt_${userId}_${Date.now()}`

  const razorpayOrder = await razorpay.orders.create({
    amount, // Already in paisa
    currency: 'INR',
    receipt,
    notes: {
      userId,
      purpose,
      matchId: matchId || '',
      ...metadata,
    },
  })

  // Create order record in database
  const paymentOrder = await prisma.paymentOrder.create({
    data: {
      userId,
      razorpayOrderId: razorpayOrder.id,
      amount,
      currency: 'INR',
      status: PaymentStatus.CREATED,
      purpose,
      matchId,
      idempotencyKey,
    },
  })

  await auditLog({
    userId,
    action: AuditAction.CREATE,
    entityType: 'PaymentOrder',
    entityId: paymentOrder.id,
    after: {
      razorpayOrderId: razorpayOrder.id,
      amount,
      purpose,
    },
  })

  logger.info('Payment order created', {
    orderId: paymentOrder.id,
    razorpayOrderId: razorpayOrder.id,
  })

  return {
    orderId: paymentOrder.id,
    razorpayOrderId: razorpayOrder.id,
    amount,
    currency: 'INR',
    keyId: process.env.RAZORPAY_KEY_ID!,
  }
}

// ============================================
// PAYMENT VERIFICATION
// ============================================

/**
 * Verify payment signature from Razorpay checkout
 * This is called after successful payment on client side
 */
export async function verifyPayment(params: VerifyPaymentParams): Promise<{
  success: boolean
  paymentOrderId?: string
  error?: string
}> {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = params

  logger.info('Verifying payment', { razorpayOrderId, razorpayPaymentId })

  // Find the order
  const paymentOrder = await prisma.paymentOrder.findUnique({
    where: { razorpayOrderId },
    include: { user: true },
  })

  if (!paymentOrder) {
    logger.warn('Payment order not found', { razorpayOrderId })
    return { success: false, error: 'Order not found' }
  }

  // Check if already processed (idempotency)
  if (paymentOrder.status === PaymentStatus.CAPTURED) {
    logger.info('Payment already verified', { orderId: paymentOrder.id })
    return { success: true, paymentOrderId: paymentOrder.id }
  }

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex')

  if (expectedSignature !== razorpaySignature) {
    logger.error('Payment signature verification failed', {
      razorpayOrderId,
      razorpayPaymentId,
    })

    await prisma.paymentOrder.update({
      where: { id: paymentOrder.id },
      data: {
        status: PaymentStatus.FAILED,
        failedAt: new Date(),
        errorMessage: 'Signature verification failed',
      },
    })

    await auditLog({
      userId: paymentOrder.userId,
      action: AuditAction.PAYMENT_FAILED,
      entityType: 'PaymentOrder',
      entityId: paymentOrder.id,
      metadata: { reason: 'Signature mismatch' },
    })

    return { success: false, error: 'Invalid signature' }
  }

  // Update order and credit wallet in a transaction
  await processSuccessfulPayment(paymentOrder.id, razorpayPaymentId, razorpaySignature)

  return { success: true, paymentOrderId: paymentOrder.id }
}

/**
 * Process a successful payment - update order and credit wallet
 */
async function processSuccessfulPayment(
  paymentOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Lock and fetch the order
    const order = await tx.paymentOrder.findUnique({
      where: { id: paymentOrderId },
    })

    if (!order || order.status === PaymentStatus.CAPTURED) {
      return // Already processed
    }

    // Update order status
    await tx.paymentOrder.update({
      where: { id: paymentOrderId },
      data: {
        status: PaymentStatus.CAPTURED,
        razorpayPaymentId,
        razorpaySignature,
        paidAt: new Date(),
        verifiedAt: new Date(),
      },
    })

    // Get or create wallet
    let wallet = await tx.wallet.findUnique({
      where: { userId: order.userId },
    })

    if (!wallet) {
      wallet = await tx.wallet.create({
        data: { userId: order.userId },
      })
    }

    const balanceBefore = wallet.balance

    // Credit wallet based on payment purpose
    if (order.purpose === PaymentPurpose.WALLET_DEPOSIT) {
      await tx.wallet.update({
        where: { userId: order.userId },
        data: {
          balance: { increment: order.amount },
          totalDeposited: { increment: order.amount },
          version: { increment: 1 },
        },
      })

      // Create transaction record
      await tx.transaction.create({
        data: {
          userId: order.userId,
          amount: order.amount,
          type: TransactionType.DEPOSIT,
          paymentOrderId: order.id,
          balanceBefore,
          balanceAfter: balanceBefore + order.amount,
          description: 'Wallet deposit via Razorpay',
        },
      })
    }
    // For MATCH_ENTRY, funds are handled by escrow service
  })

  await auditLog({
    userId: (await prisma.paymentOrder.findUnique({ where: { id: paymentOrderId } }))?.userId,
    action: AuditAction.PAYMENT_RECEIVED,
    entityType: 'PaymentOrder',
    entityId: paymentOrderId,
    metadata: { razorpayPaymentId },
  })

  logger.info('Payment processed successfully', { paymentOrderId, razorpayPaymentId })
}

// ============================================
// WEBHOOK HANDLING
// ============================================

/**
 * Verify webhook signature from Razorpay
 */
export function verifyWebhookSignature(
  body: string,
  signature: string
): boolean {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET

  if (!webhookSecret) {
    logger.error('Webhook secret not configured')
    return false
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  )
}

/**
 * Handle webhook events from Razorpay
 */
export async function handleWebhookEvent(event: WebhookEvent): Promise<void> {
  logger.info('Processing webhook event', { event: event.event })

  switch (event.event) {
    case 'payment.captured':
      await handlePaymentCaptured(event.payload.payment!.entity)
      break

    case 'payment.failed':
      await handlePaymentFailed(event.payload.payment!.entity)
      break

    case 'refund.processed':
      await handleRefundProcessed(event.payload.refund!.entity)
      break

    case 'order.paid':
      // Usually already handled by payment.captured, but good for reconciliation
      logger.info('Order paid event received', {
        orderId: event.payload.order?.entity.id,
      })
      break

    default:
      logger.info('Unhandled webhook event', { event: event.event })
  }
}

async function handlePaymentCaptured(payment: RazorpayPayment): Promise<void> {
  const order = await prisma.paymentOrder.findUnique({
    where: { razorpayOrderId: payment.order_id },
  })

  if (!order) {
    logger.warn('Order not found for captured payment', {
      orderId: payment.order_id,
    })
    return
  }

  // Idempotency check
  if (order.status === PaymentStatus.CAPTURED) {
    logger.info('Payment already captured', { orderId: order.id })
    return
  }

  await processSuccessfulPayment(order.id, payment.id, '')
}

async function handlePaymentFailed(payment: RazorpayPayment): Promise<void> {
  const order = await prisma.paymentOrder.findUnique({
    where: { razorpayOrderId: payment.order_id },
  })

  if (!order) {
    logger.warn('Order not found for failed payment', {
      orderId: payment.order_id,
    })
    return
  }

  await prisma.paymentOrder.update({
    where: { id: order.id },
    data: {
      status: PaymentStatus.FAILED,
      failedAt: new Date(),
      errorMessage: `${payment.error_code}: ${payment.error_description}`,
    },
  })

  await auditLog({
    userId: order.userId,
    action: AuditAction.PAYMENT_FAILED,
    entityType: 'PaymentOrder',
    entityId: order.id,
    metadata: {
      errorCode: payment.error_code,
      errorDescription: payment.error_description,
    },
  })

  logger.warn('Payment failed', {
    orderId: order.id,
    errorCode: payment.error_code,
  })
}

async function handleRefundProcessed(refund: RazorpayRefund): Promise<void> {
  const order = await prisma.paymentOrder.findFirst({
    where: { razorpayPaymentId: refund.payment_id },
  })

  if (!order) {
    logger.warn('Order not found for refund', {
      paymentId: refund.payment_id,
    })
    return
  }

  await prisma.paymentOrder.update({
    where: { id: order.id },
    data: {
      status: PaymentStatus.REFUNDED,
      refundedAt: new Date(),
    },
  })

  await auditLog({
    userId: order.userId,
    action: AuditAction.REFUND_ISSUED,
    entityType: 'PaymentOrder',
    entityId: order.id,
    metadata: { refundId: refund.id, amount: refund.amount },
  })

  logger.info('Refund processed', { orderId: order.id, refundId: refund.id })
}

// ============================================
// REFUNDS
// ============================================

/**
 * Issue a refund for a payment
 */
export async function issueRefund(
  paymentOrderId: string,
  amount?: number, // Partial refund amount in paisa, or full if not specified
  reason?: string
): Promise<{ success: boolean; refundId?: string; error?: string }> {
  const order = await prisma.paymentOrder.findUnique({
    where: { id: paymentOrderId },
  })

  if (!order || !order.razorpayPaymentId) {
    return { success: false, error: 'Payment not found or not captured' }
  }

  if (order.status === PaymentStatus.REFUNDED) {
    return { success: false, error: 'Already refunded' }
  }

  try {
    const razorpay = getRazorpayInstance()
    const refundAmount = amount || order.amount

    const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
      amount: refundAmount,
      notes: { reason: reason || 'Refund requested' },
    })

    logger.info('Refund initiated', {
      orderId: order.id,
      refundId: refund.id,
      amount: refundAmount,
    })

    // Note: Actual status update happens via webhook
    return { success: true, refundId: refund.id }
  } catch (error) {
    logger.error('Refund failed', { orderId: order.id, error })
    return { success: false, error: 'Refund processing failed' }
  }
}

// ============================================
// UTILITIES
// ============================================

/**
 * Get payment order by ID
 */
export async function getPaymentOrder(orderId: string) {
  return prisma.paymentOrder.findUnique({
    where: { id: orderId },
    include: { user: true, match: true },
  })
}

/**
 * Get payment order by Razorpay order ID
 */
export async function getPaymentOrderByRazorpayId(razorpayOrderId: string) {
  return prisma.paymentOrder.findUnique({
    where: { razorpayOrderId },
    include: { user: true, match: true },
  })
}

/**
 * Check if a payment is authorized/captured
 */
export async function isPaymentAuthorized(paymentOrderId: string): Promise<boolean> {
  const order = await prisma.paymentOrder.findUnique({
    where: { id: paymentOrderId },
  })

  return order?.status === PaymentStatus.CAPTURED || order?.status === PaymentStatus.AUTHORIZED
}
