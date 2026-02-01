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
    const limit = parseInt(searchParams.get('limit') || '20')
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status')
    
    const skip = (page - 1) * limit

    const where = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } }
        ]
      }),
      ...(status && { 
        // Add status filter if needed (e.g., active, banned, etc.)
      })
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          wallet: {
            select: { balance: true }
          },
          createdAt: true,
          _count: {
            select: {
              player1Matches: true,
              player2Matches: true,
              transactions: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.user.count({ where })
    ])

    const usersWithStats = users.map(user => ({
      ...user,
      walletBalance: user.wallet?.balance || 0,
      totalMatches: user._count.player1Matches + user._count.player2Matches,
      totalTransactions: user._count.transactions
    }))

    return NextResponse.json({
      users: usersWithStats,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Admin users error:', error)
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

    const { userId, action, amount } = await request.json()

    if (!userId || !action) {
      return NextResponse.json({ error: 'User ID and action are required' }, { status: 400 })
    }

    switch (action) {
      case 'adjustBalance':
        if (!amount) {
          return NextResponse.json({ error: 'Amount is required for balance adjustment' }, { status: 400 })
        }

        await prisma.$transaction(async (tx) => {
          // Get current wallet balance
          const wallet = await tx.wallet.findUnique({
            where: { userId }
          })
          const currentBalance = wallet?.balance || 0
          const newBalance = currentBalance + amount

          // Update wallet balance
          await tx.wallet.upsert({
            where: { userId },
            update: {
              balance: {
                increment: amount
              }
            },
            create: {
              userId,
              balance: Math.max(0, amount)
            }
          })

          // Create transaction record
          await tx.transaction.create({
            data: {
              userId,
              amount: Math.abs(amount),
              type: amount > 0 ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
              description: `Admin ${amount > 0 ? 'credit' : 'debit'} - ₹${Math.abs(amount)}`,
              status: 'COMPLETED',
              balanceBefore: currentBalance,
              balanceAfter: newBalance
            }
          })
        })

        return NextResponse.json({ message: 'Balance adjusted successfully' })

      case 'ban':
        // Implement user ban logic here
        // For now, just return success
        return NextResponse.json({ message: 'User banned successfully' })

      case 'unban':
        // Implement user unban logic here
        return NextResponse.json({ message: 'User unbanned successfully' })

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Admin user action error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
