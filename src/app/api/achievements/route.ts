import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

// Define achievement types and criteria
const ACHIEVEMENTS = {
  FIRST_WIN: {
    id: 'first_win',
    title: 'First Victory',
    description: 'Win your first match',
    icon: '🏆',
    points: 100
  },
  WINNING_STREAK_5: {
    id: 'winning_streak_5',
    title: 'On Fire!',
    description: 'Win 5 matches in a row',
    icon: '🔥',
    points: 500
  },
  WINNING_STREAK_10: {
    id: 'winning_streak_10',
    title: 'Unstoppable',
    description: 'Win 10 matches in a row',
    icon: '⚡',
    points: 1000
  },
  SPEED_DEMON: {
    id: 'speed_demon',
    title: 'Speed Demon',
    description: 'Complete a match in under 5 minutes',
    icon: '⚡',
    points: 300
  },
  TOURNAMENT_WINNER: {
    id: 'tournament_winner',
    title: 'Tournament Champion',
    description: 'Win a tournament',
    icon: '👑',
    points: 2000
  },
  PERFECT_GAME: {
    id: 'perfect_game',
    title: 'Perfect Game',
    description: 'Complete a match without any mistakes',
    icon: '💎',
    points: 750
  },
  DAILY_PLAYER: {
    id: 'daily_player',
    title: 'Daily Player',
    description: 'Play for 7 consecutive days',
    icon: '📅',
    points: 400
  },
  BIG_SPENDER: {
    id: 'big_spender',
    title: 'High Roller',
    description: 'Add ₹1000 or more to wallet',
    icon: '💰',
    points: 200
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Get user's current achievements from database
    const userAchievements = await prisma.userAchievement.findMany({
      where: { userId },
      select: {
        achievementId: true,
        unlockedAt: true
      }
    })

    const unlockedIds = new Set(userAchievements.map(a => a.achievementId))

    // Check for new achievements
    const newAchievements = await checkForNewAchievements(userId, unlockedIds)

    // Save new achievements to database
    if (newAchievements.length > 0) {
      await prisma.userAchievement.createMany({
        data: newAchievements.map(achievementId => ({
          userId,
          achievementId,
          unlockedAt: new Date()
        })),
        skipDuplicates: true
      })
    }

    // Prepare response data
    const allAchievements = Object.values(ACHIEVEMENTS).map(achievement => ({
      ...achievement,
      unlocked: unlockedIds.has(achievement.id) || newAchievements.includes(achievement.id),
      unlockedAt: userAchievements.find(a => a.achievementId === achievement.id)?.unlockedAt
    }))

    const totalPoints = allAchievements
      .filter(a => a.unlocked)
      .reduce((sum, a) => sum + a.points, 0)

    return NextResponse.json({
      achievements: allAchievements,
      totalPoints,
      newAchievements: newAchievements.map(id => ACHIEVEMENTS[id as keyof typeof ACHIEVEMENTS])
    })
  } catch (error) {
    console.error('Achievements error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function checkForNewAchievements(userId: string, unlockedIds: Set<string>): Promise<string[]> {
  const newAchievements: string[] = []

  try {
    // Get user's match statistics
    const [totalWins, recentMatches, transactions] = await Promise.all([
      // Total wins
      prisma.match.count({
        where: {
          OR: [
            { player1Id: userId },
            { player2Id: userId }
          ],
          winnerId: userId,
          status: 'FINISHED'
        }
      }),

      // Recent matches for streak calculation
      prisma.match.findMany({
        where: {
          OR: [
            { player1Id: userId },
            { player2Id: userId }
          ],
          status: 'FINISHED'
        },
        orderBy: { endedAt: 'desc' },
        take: 20,
        select: {
          winnerId: true,
          endedAt: true,
          createdAt: true
        }
      }),

      // Recent transactions for spending achievements
      prisma.transaction.findMany({
        where: {
          userId,
          type: 'DEPOSIT',
          status: 'COMPLETED'
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          amount: true,
          createdAt: true
        }
      })
    ])

    // Check First Win
    if (totalWins >= 1 && !unlockedIds.has('first_win')) {
      newAchievements.push('first_win')
    }

    // Check winning streaks
    let currentStreak = 0
    for (const match of recentMatches) {
      if (match.winnerId === userId) {
        currentStreak++
      } else {
        break
      }
    }

    if (currentStreak >= 5 && !unlockedIds.has('winning_streak_5')) {
      newAchievements.push('winning_streak_5')
    }

    if (currentStreak >= 10 && !unlockedIds.has('winning_streak_10')) {
      newAchievements.push('winning_streak_10')
    }

    // Check speed demon (completed in under 5 minutes)
    const speedMatches = recentMatches.filter(match => {
      if (!match.endedAt || !match.createdAt) return false
      const duration = match.endedAt.getTime() - match.createdAt.getTime()
      return duration < 5 * 60 * 1000 && match.winnerId === userId
    })

    if (speedMatches.length > 0 && !unlockedIds.has('speed_demon')) {
      newAchievements.push('speed_demon')
    }

    // Check big spender
    const bigTransaction = transactions.find(t => t.amount >= 1000)
    if (bigTransaction && !unlockedIds.has('big_spender')) {
      newAchievements.push('big_spender')
    }

    // Check tournament winner
    const tournamentWins = await prisma.tournament.count({
      where: {
        winnerId: userId,
        status: 'COMPLETED'
      }
    })

    if (tournamentWins > 0 && !unlockedIds.has('tournament_winner')) {
      newAchievements.push('tournament_winner')
    }

    return newAchievements
  } catch (error) {
    console.error('Error checking achievements:', error)
    return []
  }
}
