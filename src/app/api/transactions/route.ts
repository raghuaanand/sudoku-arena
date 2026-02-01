import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const type = searchParams.get('type') // Optional filter by type
    
    const skip = (page - 1) * limit

    // Validate type parameter against new enum values
    const validTypes = ['DEPOSIT', 'WITHDRAWAL', 'ENTRY_FEE', 'ESCROW_LOCK', 'ESCROW_RELEASE', 'WINNINGS', 'REFUND', 'PLATFORM_FEE', 'ADMIN_CREDIT', 'ADMIN_DEBIT']
    const where = {
      userId: session.user.id,
      ...(type && validTypes.includes(type) && { type: type as any })
    }

    const [rawTransactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          amount: true,
          type: true,
          description: true,
          status: true,
          createdAt: true,
          balanceBefore: true,
          balanceAfter: true
        }
      }),
      prisma.transaction.count({ where })
    ])

    // Map transaction types to CREDIT/DEBIT for frontend compatibility
    const creditTypes = ['DEPOSIT', 'WINNINGS', 'ESCROW_RELEASE', 'REFUND', 'ADMIN_CREDIT']
    const transactions = rawTransactions.map(transaction => ({
      ...transaction,
      // Convert paisa to rupees for display
      amount: Math.abs(transaction.amount) / 100,
      type: creditTypes.includes(transaction.type) ? 'CREDIT' : 'DEBIT'
    }))

    return NextResponse.json({
      transactions,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Transaction history error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
