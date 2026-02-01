import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin (you can implement role-based auth)
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true }
    })

    // For now, consider any user with 'admin' in email as admin
    // In production, implement proper role-based authorization
    const isAdmin = user?.email?.includes('admin') || false

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get comprehensive system statistics
    const [
      totalUsers,
      activeMatches,
      totalMatches,
      completedMatches,
      totalTransactions,
      pendingTransactions,
      totalRevenue,
      userStats,
      recentSignups,
      matchTypeStats
    ] = await Promise.all([
      // Total users
      prisma.user.count(),
      
      // Active matches
      prisma.match.count({
        where: { 
          status: { in: ['WAITING', 'ONGOING'] }
        }
      }),
      
      // Total matches
      prisma.match.count(),
      
      // Completed matches
      prisma.match.count({
        where: { status: 'FINISHED' }
      }),
      
      // Total transactions
      prisma.transaction.count(),
      
      // Pending transactions
      prisma.transaction.count({
        where: { status: 'PENDING' }
      }),
      
      // Total revenue (completed transactions)
      prisma.transaction.aggregate({
        where: { 
          status: 'COMPLETED',
          type: { in: ['DEPOSIT', 'ENTRY_FEE'] }
        },
        _sum: { amount: true }
      }),
      
      // User stats by month
      prisma.user.groupBy({
        by: ['createdAt'],
        _count: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 6
      }),
      
      // Recent signups (last 7 days)
      prisma.user.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }
      }),
      
      // Match type statistics
      prisma.match.groupBy({
        by: ['type'],
        _count: { id: true }
      })
    ])

    const stats = {
      totalUsers,
      activeMatches,
      totalMatches,
      completedMatches,
      totalTransactions,
      pendingTransactions,
      totalRevenue: totalRevenue._sum.amount || 0,
      recentSignups,
      avgResponseTime: Math.random() * 100 + 50, // Mock - implement real monitoring
      socketConnections: Math.floor(Math.random() * 100), // Mock - get from socket server
      databaseConnections: 5, // Mock - get from connection pool
      matchTypeStats: matchTypeStats.reduce((acc, stat) => {
        acc[stat.type] = stat._count.id
        return acc
      }, {} as Record<string, number>),
      userGrowth: userStats.slice(0, 6).map(stat => ({
        month: stat.createdAt.toISOString().substring(0, 7),
        users: stat._count.id
      })),
      completionRate: totalMatches > 0 ? (completedMatches / totalMatches) * 100 : 0
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error('Admin stats error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
