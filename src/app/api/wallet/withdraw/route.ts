import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TransactionType, TransactionStatus } from '@prisma/client'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { amount, bankDetails } = await request.json()

    // Convert to paisa if needed (assuming input is in rupees)
    const amountInPaisa = amount * 100

    if (!amount || amountInPaisa < 10000) { // ₹100 minimum
      return NextResponse.json({ error: 'Minimum withdrawal amount is ₹100' }, { status: 400 })
    }

    if (!bankDetails?.accountNumber || !bankDetails?.ifscCode || !bankDetails?.accountHolderName) {
      return NextResponse.json({ error: 'Bank details are required for withdrawal' }, { status: 400 })
    }

    // Start a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Get or create wallet
      let wallet = await tx.wallet.findUnique({
        where: { userId: session.user.id }
      })

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: { userId: session.user.id }
        })
      }

      const availableBalance = wallet.balance - wallet.escrowBalance
      if (availableBalance < amountInPaisa) {
        throw new Error('Insufficient balance')
      }

      // Update wallet with optimistic locking
      const updated = await tx.wallet.updateMany({
        where: {
          userId: session.user.id,
          version: wallet.version
        },
        data: {
          balance: { decrement: amountInPaisa },
          totalWithdrawn: { increment: amountInPaisa },
          version: { increment: 1 }
        }
      })

      if (updated.count === 0) {
        throw new Error('Concurrent modification detected')
      }

      // Create withdrawal transaction
      const transaction = await tx.transaction.create({
        data: {
          userId: session.user.id,
          amount: -amountInPaisa,
          type: TransactionType.WITHDRAWAL,
          description: `Wallet withdrawal - ₹${amount} to ${bankDetails.accountNumber}`,
          status: TransactionStatus.PENDING,
          balanceBefore: wallet.balance,
          balanceAfter: wallet.balance - amountInPaisa,
          metadata: {
            bankAccountNumber: bankDetails.accountNumber.slice(-4), // Store only last 4 digits
            ifscCode: bankDetails.ifscCode,
            accountHolderName: bankDetails.accountHolderName
          }
        }
      })

      return { 
        transaction, 
        newBalance: wallet.balance - amountInPaisa,
        escrowBalance: wallet.escrowBalance
      }
    })

    return NextResponse.json({
      message: 'Withdrawal request submitted successfully',
      transactionId: result.transaction.id,
      newBalance: result.newBalance,
      availableBalance: result.newBalance - result.escrowBalance
    })
  } catch (error: unknown) {
    console.error('Withdrawal error:', error)
    
    if (error instanceof Error && error.message === 'Insufficient balance') {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
