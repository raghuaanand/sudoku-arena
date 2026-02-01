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
    const period = searchParams.get('period') || 'all' // all, week, month
    const limit = parseInt(searchParams.get('limit') || '50')

    // Calculate date filter based on period
    let dateFilter = {}
    if (period === 'week') {
      dateFilter = {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }
      }
    } else if (period === 'month') {
      dateFilter = {
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        }
      }
    }

    // Get user rankings based on wins
    const userRankings = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        _count: {
          select: {
            player1Matches: {
              where: {
                ...dateFilter,
                status: 'FINISHED',
                winnerId: { not: null }
              }
            },
            player2Matches: {
              where: {
                ...dateFilter,
                status: 'FINISHED',
                winnerId: { not: null }
              }
            }
          }
        }
      },
      take: limit
    })

    // Calculate win statistics for each user
    const rankings = await Promise.all(
      userRankings.map(async (user) => {
        // Get wins as player1
        const player1Wins = await prisma.match.count({
          where: {
            ...dateFilter,
            player1Id: user.id,
            status: 'FINISHED',
            winnerId: user.id
          }
        })

        // Get wins as player2
        const player2Wins = await prisma.match.count({
          where: {
            ...dateFilter,
            player2Id: user.id,
            status: 'FINISHED',
            winnerId: user.id
          }
        })

        // Get total matches played
        const totalMatches = await prisma.match.count({
          where: {
            ...dateFilter,
            OR: [
              { player1Id: user.id },
              { player2Id: user.id }
            ],
            status: 'FINISHED'
          }
        })

        const totalWins = player1Wins + player2Wins
        const winRate = totalMatches > 0 ? (totalWins / totalMatches) * 100 : 0

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          totalWins,
          totalMatches,
          winRate: Math.round(winRate * 100) / 100,
          joinedAt: user.createdAt
        }
      })
    )

    // Sort by wins then by win rate
    rankings.sort((a, b) => {
      if (b.totalWins !== a.totalWins) {
        return b.totalWins - a.totalWins
      }
      return b.winRate - a.winRate
    })

    // Add rank to each user
    const rankedUsers = rankings.map((user, index) => ({
      ...user,
      rank: index + 1
    }))

    // Get current user's ranking
    const currentUserRank = rankedUsers.find(user => user.id === session.user.id)

    return NextResponse.json({
      rankings: rankedUsers,
      currentUser: currentUserRank,
      period,
      total: rankedUsers.length
    })
  } catch (error) {
    console.error('Rankings error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
