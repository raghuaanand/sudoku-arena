import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Get all user's matches (including single player)
    const [
      totalGamesPlayed,
      singlePlayerGames,
      multiplayerGames,
      gamesWon,
      recentMatches
    ] = await Promise.all([
      // Total games played (all types including single player)
      prisma.match.count({
        where: {
          OR: [
            { player1Id: userId },
            { player2Id: userId }
          ],
          status: 'FINISHED'
        }
      }),
      
      // Single player games
      prisma.match.count({
        where: {
          player1Id: userId,
          type: 'SINGLE_PLAYER',
          status: 'FINISHED'
        }
      }),
      
      // Multiplayer games
      prisma.match.count({
        where: {
          OR: [
            { player1Id: userId },
            { player2Id: userId }
          ],
          type: { not: 'SINGLE_PLAYER' },
          status: 'FINISHED'
        }
      }),
      
      // Games won (for multiplayer - single player doesn't have a winner concept)
      prisma.match.count({
        where: {
          winnerId: userId,
          status: 'FINISHED'
        }
      }),
      
      // Recent matches (last 10) - include all types
      prisma.match.findMany({
        where: {
          OR: [
            { player1Id: userId },
            { player2Id: userId }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          player1: { select: { id: true, name: true, image: true } },
          player2: { select: { id: true, name: true, image: true } },
          winner: { select: { id: true, name: true } }
        }
      })
    ])

    // Calculate win rate (only for multiplayer games)
    const winRate = multiplayerGames > 0 
      ? Math.round((gamesWon / multiplayerGames) * 100) 
      : 0

    return NextResponse.json({
      totalGamesPlayed,
      singlePlayerGames,
      multiplayerGames,
      gamesWon,
      winRate,
      recentMatches: recentMatches.map(match => ({
        id: match.id,
        type: match.type,
        status: match.status,
        createdAt: match.createdAt,
        endedAt: match.endedAt,
        player1: match.player1,
        player2: match.player2,
        winner: match.winner,
        prizePool: match.prizePool,
        isWinner: match.winnerId === userId,
        isSinglePlayer: match.type === 'SINGLE_PLAYER'
      }))
    })

  } catch (error) {
    console.error('User stats error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user stats' },
      { status: 500 }
    )
  }
}
