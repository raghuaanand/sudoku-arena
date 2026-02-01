import { prisma } from '@/lib/prisma'
import { Match, TransactionStatus } from '@prisma/client'

export interface GameAnalytics {
  totalGames: number
  totalUsers: number
  activeUsers: number
  avgSessionTime: number
  peakHours: HourlyStats[]
  popularDifficulties: DifficultyStats[]
  userRetention: RetentionStats
  revenueStats: RevenueStats
  gameCompletionRates: CompletionStats
  multiplayerStats: MultiplayerStats
}

export interface HourlyStats {
  hour: number
  gameCount: number
  userCount: number
}

export interface DifficultyStats {
  difficulty: 'easy' | 'medium' | 'hard'
  gameCount: number
  completionRate: number
  avgTime: number
}

export interface RetentionStats {
  day1: number
  day7: number
  day30: number
  avgSessionsPerUser: number
}

export interface RevenueStats {
  totalRevenue: number
  monthlyRevenue: number
  avgRevenuePerUser: number
  topPayingUsers: UserRevenue[]
}

export interface UserRevenue {
  userId: string
  userName: string
  totalSpent: number
  gamesPlayed: number
}

export interface CompletionStats {
  easy: number
  medium: number
  hard: number
  overall: number
}

export interface MultiplayerStats {
  totalMatches: number
  activeMatches: number
  avgMatchDuration: number
  winRateDistribution: WinRateDistribution[]
}

export interface WinRateDistribution {
  range: string
  userCount: number
}

export interface UserEngagementMetrics {
  userId: string
  totalPlayTime: number
  gamesCompleted: number
  avgCompletionTime: number
  streakRecord: number
  skillProgression: SkillProgression[]
  preferredDifficulty: 'easy' | 'medium' | 'hard'
  socialInteractions: number
}

export interface SkillProgression {
  date: string
  skillRating: number
  gamesPlayed: number
}

export class GameAnalyticsService {
  /**
   * Get comprehensive game analytics
   */
  static async getGameAnalytics(timeRange: '24h' | '7d' | '30d' | '90d' = '30d'): Promise<GameAnalytics> {
    const startDate = this.getStartDate(timeRange)
    
    const [
      totalGames,
      totalUsers,
      activeUsers,
      sessionStats,
      peakHours,
      popularDifficulties,
      retentionStats,
      revenueStats,
      completionStats,
      multiplayerStats
    ] = await Promise.all([
      this.getTotalGames(startDate),
      this.getTotalUsers(),
      this.getActiveUsers(startDate),
      this.getSessionStats(startDate),
      this.getPeakHours(startDate),
      this.getPopularDifficulties(startDate),
      this.getRetentionStats(),
      this.getRevenueStats(startDate),
      this.getCompletionStats(startDate),
      this.getMultiplayerStats(startDate)
    ])

    return {
      totalGames,
      totalUsers,
      activeUsers,
      avgSessionTime: sessionStats.avgSessionTime,
      peakHours,
      popularDifficulties,
      userRetention: retentionStats,
      revenueStats,
      gameCompletionRates: completionStats,
      multiplayerStats
    }
  }

  /**
   * Get user engagement metrics
   */
  static async getUserEngagementMetrics(userId: string): Promise<UserEngagementMetrics> {
    const userMatches = await prisma.match.findMany({
      where: {
        OR: [
          { player1Id: userId },
          { player2Id: userId }
        ]
      },
      orderBy: { createdAt: 'asc' }
    })

    const completedMatches = userMatches.filter(match => match.status === 'FINISHED')
    const totalPlayTime = completedMatches.reduce((total, match) => {
      if (match.startedAt && match.endedAt) {
        return total + (match.endedAt.getTime() - match.startedAt.getTime())
      }
      return total
    }, 0)

    const avgCompletionTime = completedMatches.length > 0 
      ? totalPlayTime / completedMatches.length / 1000 // Convert to seconds
      : 0

    // Calculate skill progression (mock implementation)
    const skillProgression = this.calculateSkillProgression(userMatches)

    // Determine preferred difficulty based on match history
    const difficultyMap = new Map<string, number>()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    userMatches.forEach(_match => {
      // This would need to be stored in match metadata in a real implementation
      const difficulty = 'medium' // Placeholder
      difficultyMap.set(difficulty, (difficultyMap.get(difficulty) || 0) + 1)
    })

    const preferredDifficulty = Array.from(difficultyMap.entries())
      .sort(([,a], [,b]) => b - a)[0]?.[0] as 'easy' | 'medium' | 'hard' || 'medium'

    // Calculate streak record
    const streakRecord = this.calculateStreakRecord(userId, userMatches)

    return {
      userId,
      totalPlayTime: Math.round(totalPlayTime / 1000), // Convert to seconds
      gamesCompleted: completedMatches.length,
      avgCompletionTime: Math.round(avgCompletionTime),
      streakRecord,
      skillProgression,
      preferredDifficulty,
      socialInteractions: userMatches.filter(match => match.player2Id).length
    }
  }

  /**
   * Track game events for analytics
   */
  static async trackGameEvent(
    userId: string,
    event: 'game_started' | 'game_completed' | 'game_abandoned' | 'hint_used' | 'error_made',
    metadata?: Record<string, unknown>
  ) {
    // In a production app, you'd store these events in a separate analytics table
    // For now, we'll log them
    console.log('Game Event Tracked:', {
      userId,
      event,
      metadata,
      timestamp: new Date().toISOString()
    })

    // Store critical events in database
    if (event === 'game_completed') {
      // This could trigger achievement checks, skill rating updates, etc.
      await this.handleGameCompletion(userId, metadata)
    }
  }

  /**
   * Get real-time game statistics
   */
  static async getRealTimeStats() {
    const [activeMatches, onlineUsers, queueLength] = await Promise.all([
      prisma.match.count({
        where: { status: 'ONGOING' }
      }),
      // In a real app, you'd track online users via Redis or similar
      prisma.user.count({
        where: {
          updatedAt: {
            gte: new Date(Date.now() - 15 * 60 * 1000) // Last 15 minutes
          }
        }
      }),
      // Queue length would come from the matchmaking service
      0 // Placeholder
    ])

    return {
      activeMatches,
      onlineUsers,
      queueLength,
      timestamp: new Date().toISOString()
    }
  }

  // Private helper methods

  private static getStartDate(timeRange: string): Date {
    const now = new Date()
    switch (timeRange) {
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000)
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }
  }

  private static async getTotalGames(startDate: Date): Promise<number> {
    return prisma.match.count({
      where: {
        createdAt: { gte: startDate }
      }
    })
  }

  private static async getTotalUsers(): Promise<number> {
    return prisma.user.count()
  }

  private static async getActiveUsers(startDate: Date): Promise<number> {
    return prisma.user.count({
      where: {
        OR: [
          {
            player1Matches: {
              some: {
                createdAt: { gte: startDate }
              }
            }
          },
          {
            player2Matches: {
              some: {
                createdAt: { gte: startDate }
              }
            }
          }
        ]
      }
    })
  }

  private static async getSessionStats(startDate: Date) {
    const matches = await prisma.match.findMany({
      where: {
        createdAt: { gte: startDate }
      },
      select: {
        startedAt: true,
        endedAt: true
      }
    })

    const sessionTimes = matches
      .filter(match => match.startedAt && match.endedAt)
      .map(match => match.endedAt!.getTime() - match.startedAt!.getTime())

    const avgSessionTime = sessionTimes.length > 0
      ? sessionTimes.reduce((a, b) => a + b, 0) / sessionTimes.length / 1000 // Convert to seconds
      : 0

    return { avgSessionTime: Math.round(avgSessionTime) }
  }

  private static async getPeakHours(startDate: Date): Promise<HourlyStats[]> {
    const matches = await prisma.match.findMany({
      where: {
        createdAt: { gte: startDate }
      },
      select: {
        createdAt: true,
        player1Id: true,
        player2Id: true
      }
    })

    const hourlyStats = new Map<number, { gameCount: number; users: Set<string> }>()

    matches.forEach(match => {
      const hour = match.createdAt.getHours()
      const stats = hourlyStats.get(hour) || { gameCount: 0, users: new Set() }
      
      stats.gameCount++
      stats.users.add(match.player1Id)
      if (match.player2Id) stats.users.add(match.player2Id)
      
      hourlyStats.set(hour, stats)
    })

    return Array.from(hourlyStats.entries()).map(([hour, stats]) => ({
      hour,
      gameCount: stats.gameCount,
      userCount: stats.users.size
    })).sort((a, b) => a.hour - b.hour)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private static async getPopularDifficulties(_startDate: Date): Promise<DifficultyStats[]> {
    // This would need difficulty data stored in matches
    // For now, return mock data
    return [
      { difficulty: 'easy', gameCount: 150, completionRate: 85, avgTime: 180 },
      { difficulty: 'medium', gameCount: 120, completionRate: 70, avgTime: 300 },
      { difficulty: 'hard', gameCount: 80, completionRate: 45, avgTime: 600 }
    ]
  }

  private static async getRetentionStats(): Promise<RetentionStats> {
    // Complex query to calculate retention rates
    // This is a simplified version
    // const totalUsers = await prisma.user.count()
    
    // Mock retention data - in production you'd calculate this properly
    return {
      day1: 0.75,
      day7: 0.45,
      day30: 0.25,
      avgSessionsPerUser: 3.2
    }
  }

  private static async getRevenueStats(startDate: Date): Promise<RevenueStats> {
    const transactions = await prisma.transaction.findMany({
      where: {
        createdAt: { gte: startDate },
        type: 'DEPOSIT',
        status: TransactionStatus.COMPLETED
      },
      select: {
        userId: true,
        amount: true
      }
    })

    const totalRevenue = transactions.reduce((sum, t) => sum + t.amount, 0)
    const uniqueUsers = new Set(transactions.map(t => t.userId)).size
    const avgRevenuePerUser = uniqueUsers > 0 ? totalRevenue / uniqueUsers : 0

    // Calculate top paying users
    const userRevenue = new Map<string, { total: number; games: number }>()
    
    for (const transaction of transactions) {
      const current = userRevenue.get(transaction.userId) || { 
        total: 0, 
        games: 0 
      }
      current.total += transaction.amount
      userRevenue.set(transaction.userId, current)
    }

    // Fetch user names for top paying users
    const topUserIds = Array.from(userRevenue.entries())
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 10)
      .map(([userId]) => userId)

    const users = await prisma.user.findMany({
      where: { id: { in: topUserIds } },
      select: { id: true, name: true }
    })

    const userNameMap = new Map(users.map(u => [u.id, u.name || 'Unknown']))

    const topPayingUsers = topUserIds.map(userId => ({
      userId,
      userName: userNameMap.get(userId) || 'Unknown',
      totalSpent: userRevenue.get(userId)?.total || 0,
      gamesPlayed: userRevenue.get(userId)?.games || 0
    }))

    return {
      totalRevenue,
      monthlyRevenue: totalRevenue, // Simplified
      avgRevenuePerUser: Math.round(avgRevenuePerUser),
      topPayingUsers
    }
  }

  private static async getCompletionStats(startDate: Date): Promise<CompletionStats> {
    const totalMatches = await prisma.match.count({
      where: { createdAt: { gte: startDate } }
    })

    const completedMatches = await prisma.match.count({
      where: {
        createdAt: { gte: startDate },
        status: 'FINISHED'
      }
    })

    const overall = totalMatches > 0 ? (completedMatches / totalMatches) * 100 : 0

    // Mock difficulty-specific data
    return {
      easy: 85,
      medium: 70,
      hard: 45,
      overall: Math.round(overall)
    }
  }

  private static async getMultiplayerStats(startDate: Date): Promise<MultiplayerStats> {
    const multiplayerMatches = await prisma.match.findMany({
      where: {
        createdAt: { gte: startDate },
        player2Id: { not: null }
      },
      select: {
        status: true,
        startedAt: true,
        endedAt: true
      }
    })

    const totalMatches = multiplayerMatches.length
    const activeMatches = multiplayerMatches.filter(m => m.status === 'ONGOING').length

    const completedMatches = multiplayerMatches.filter(m => 
      m.status === 'FINISHED' && m.startedAt && m.endedAt
    )

    const avgMatchDuration = completedMatches.length > 0
      ? completedMatches.reduce((sum, match) => {
          return sum + (match.endedAt!.getTime() - match.startedAt!.getTime())
        }, 0) / completedMatches.length / 1000 // Convert to seconds
      : 0

    // Mock win rate distribution
    const winRateDistribution = [
      { range: '0-20%', userCount: 15 },
      { range: '21-40%', userCount: 25 },
      { range: '41-60%', userCount: 35 },
      { range: '61-80%', userCount: 20 },
      { range: '81-100%', userCount: 5 }
    ]

    return {
      totalMatches,
      activeMatches,
      avgMatchDuration: Math.round(avgMatchDuration),
      winRateDistribution
    }
  }

  private static calculateSkillProgression(matches: Array<{
    createdAt: Date
    endedAt: Date | null
    winnerId: string | null
    player1Id: string
    player2Id: string | null
  }>): SkillProgression[] {
    // Simplified skill progression calculation
    const progressionMap = new Map<string, { rating: number; games: number }>()
    
    matches.forEach((match) => {
      const date = match.createdAt.toISOString().split('T')[0]
      const current = progressionMap.get(date) || { rating: 1000, games: 0 }
      
      // Simple skill calculation based on wins
      if (match.winnerId === match.player1Id || (match.player2Id && match.winnerId === match.player2Id)) {
        current.rating += 10
      } else {
        current.rating -= 5
      }
      current.games++
      
      progressionMap.set(date, current)
    })

    return Array.from(progressionMap.entries()).map(([date, data]) => ({
      date,
      skillRating: data.rating,
      gamesPlayed: data.games
    })).sort((a, b) => a.date.localeCompare(b.date))
  }

  private static calculateStreakRecord(userId: string, matches: Match[]): number {
    let maxStreak = 0
    let currentStreak = 0

    const sortedMatches = matches
      .filter(match => match.status === 'FINISHED')
      .sort((a, b) => {
        const aTime = a.endedAt?.getTime() || 0
        const bTime = b.endedAt?.getTime() || 0
        return aTime - bTime
      })

    for (const match of sortedMatches) {
      if (match.winnerId === userId) {
        currentStreak++
        maxStreak = Math.max(maxStreak, currentStreak)
      } else {
        currentStreak = 0
      }
    }

    return maxStreak
  }

  private static async handleGameCompletion(userId: string, metadata?: Record<string, unknown>) {
    // Handle post-game completion logic
    // Update achievements, skill ratings, etc.
    console.log('Game completion handled for user:', userId, metadata)
  }
}

export default GameAnalyticsService
