import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TransactionType } from '@prisma/client'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get or create wallet
    let wallet = await prisma.wallet.findUnique({
      where: { userId: session.user.id }
    })

    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId: session.user.id }
      })
    }

    return NextResponse.json({ 
      balance: wallet.balance,
      escrowBalance: wallet.escrowBalance,
      availableBalance: wallet.balance - wallet.escrowBalance
    })
  } catch (error) {
    console.error('Wallet balance error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { amount, type, description } = await request.json()

    if (!amount || !type) {
      return NextResponse.json({ error: 'Amount and type are required' }, { status: 400 })
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

      const currentBalance = wallet.balance
      let newBalance: number
      let txType: TransactionType

      if (type === 'CREDIT') {
        newBalance = currentBalance + amount
        txType = TransactionType.ADMIN_CREDIT
      } else if (type === 'DEBIT') {
        if (currentBalance - wallet.escrowBalance < amount) {
          throw new Error('Insufficient balance')
        }
        newBalance = currentBalance - amount
        txType = TransactionType.ADMIN_DEBIT
      } else {
        throw new Error('Invalid transaction type')
      }

      // Update wallet balance with optimistic locking
      const updated = await tx.wallet.updateMany({
        where: { 
          userId: session.user.id,
          version: wallet.version
        },
        data: { 
          balance: newBalance,
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
          amount: type === 'CREDIT' ? amount : -amount,
          type: txType,
          description: description || `${type.toLowerCase()} transaction`,
          status: 'COMPLETED',
          balanceBefore: currentBalance,
          balanceAfter: newBalance
        }
      })

      return { 
        balance: newBalance,
        escrowBalance: wallet.escrowBalance,
        transaction 
      }
    })

    return NextResponse.json({
      balance: result.balance,
      escrowBalance: result.escrowBalance,
      availableBalance: result.balance - result.escrowBalance,
      transaction: result.transaction
    })
  } catch (error) {
    console.error('Wallet transaction error:', error)
    
    if (error instanceof Error) {
      if (error.message === 'Insufficient balance') {
        return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
      }
      if (error.message === 'User not found') {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
