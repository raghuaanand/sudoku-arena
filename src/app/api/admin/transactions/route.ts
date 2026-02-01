import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TransactionType, TransactionStatus, Prisma } from '@prisma/client'

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin access
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true }
    })

    const isAdmin = user?.email?.includes('admin') || false
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const type = searchParams.get('type') as TransactionType | null
    const status = searchParams.get('status') as TransactionStatus | null
    
    const skip = (page - 1) * limit

    const where: Prisma.TransactionWhereInput = {
      ...(type && { type }),
      ...(status && { status })
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.transaction.count({ where })
    ])

    // Get summary statistics
    const [totalRevenue, pendingAmount, failedCount] = await Promise.all([
      prisma.transaction.aggregate({
        where: { status: 'COMPLETED', type: { in: ['DEPOSIT', 'ENTRY_FEE'] } },
        _sum: { amount: true }
      }),
      prisma.transaction.aggregate({
        where: { status: 'PENDING' },
        _sum: { amount: true }
      }),
      prisma.transaction.count({
        where: { status: 'FAILED' }
      })
    ])

    return NextResponse.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      summary: {
        totalRevenue: totalRevenue._sum.amount || 0,
        pendingAmount: pendingAmount._sum.amount || 0,
        failedCount
      }
    })
  } catch (error) {
    console.error('Admin transactions error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin access
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true }
    })

    const isAdmin = user?.email?.includes('admin') || false
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { transactionId, action } = await request.json()

    if (!transactionId || !action) {
      return NextResponse.json({ error: 'Transaction ID and action are required' }, { status: 400 })
    }

    switch (action) {
      case 'approve':
        await prisma.$transaction(async (tx) => {
          const transaction = await tx.transaction.findUnique({
            where: { id: transactionId }
          })

          if (!transaction) {
            throw new Error('Transaction not found')
          }

          // Update transaction status
          await tx.transaction.update({
            where: { id: transactionId },
            data: { status: 'COMPLETED' }
          })

          // If it's a credit transaction, update wallet balance
          if (transaction.type === 'DEPOSIT' || transaction.type === 'ADMIN_CREDIT') {
            await tx.wallet.update({
              where: { userId: transaction.userId },
              data: {
                balance: {
                  increment: transaction.amount
                }
              }
            })
          }
        })

        return NextResponse.json({ message: 'Transaction approved successfully' })

      case 'reject':
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { status: 'FAILED' }
        })
        return NextResponse.json({ message: 'Transaction rejected successfully' })

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Admin transaction action error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
