// Matchmaking service for real-time multiplayer games with skill-based and FCFS matching
import { prisma } from '@/lib/prisma'
import { MatchType } from '@/types'
import { generatePuzzle } from '@/utils/sudoku'

export interface PlayerStats {
  userId: string
  skillRating: number
  gamesPlayed: number
  winRate: number
  averageTime: number
  recentPerformance: number[]
}

export interface MatchmakingQueue {
  userId: string
  difficulty: 'easy' | 'medium' | 'hard'
  matchType: MatchType
  timestamp: Date
  skillRating: number
  preferences: MatchPreferences
}

export interface MatchPreferences {
  maxSkillDifference: number
  maxWaitTime: number
  preferredOpponentLevel: 'similar' | 'higher' | 'lower' | 'any'
}

export interface SimpleQueueEntry {
  userId: string
  difficulty: 'easy' | 'medium' | 'hard'
  matchType: MatchType
  timestamp: Date
}

export class SkillBasedMatchmaking {
  private static queue: MatchmakingQueue[] = []
  private static simpleQueue: SimpleQueueEntry[] = []
  private static readonly MATCH_TIMEOUT = 120000 // 2 minutes
  private static readonly SKILL_EXPANSION_RATE = 10 // Expand skill search by 10 points per 10 seconds
  private static readonly FCFS_USER_THRESHOLD = 100 // Use FCFS when active users < 100

  /**
   * Get total active users count (simplified approach)
   */
  private static async getActiveUsersCount(): Promise<number> {
    try {
      // Count total queue size as proxy for active users
      const queueSize = this.queue.length + this.simpleQueue.length
      
      // Also count recent matches as indicator of activity
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
      const recentMatches = await prisma.match.count({
        where: {
          createdAt: {
            gte: fiveMinutesAgo
          }
        }
      })
      
      // Estimate active users based on queue + recent match activity
      const estimatedActiveUsers = queueSize + (recentMatches * 2)
      return estimatedActiveUsers
    } catch (error) {
      console.error('Error getting active users count:', error)
      // Return high number to default to skill-based matching
      return 200
    }
  }

  /**
   * Determine if we should use FCFS or skill-based matching
   */
  private static async shouldUseFCFS(): Promise<boolean> {
    const activeUsers = await this.getActiveUsersCount()
    console.log(`Active users: ${activeUsers}, using ${activeUsers < this.FCFS_USER_THRESHOLD ? 'FCFS' : 'skill-based'} matching`)
    return activeUsers < this.FCFS_USER_THRESHOLD
  }

  /**
   * Add player to appropriate queue (FCFS or skill-based)
   */
  static async addToQueue(
    userId: string, 
    difficulty: 'easy' | 'medium' | 'hard', 
    matchType: MatchType,
    preferences?: Partial<MatchPreferences>
  ): Promise<string | null> {
    const useFCFS = await this.shouldUseFCFS()
    
    if (useFCFS) {
      return this.addToSimpleQueue(userId, difficulty, matchType)
    } else {
      return this.addToSkillBasedQueue(userId, difficulty, matchType, preferences)
    }
  }

  /**
   * Add player to skill-based queue
   */
  private static async addToSkillBasedQueue(
    userId: string, 
    difficulty: 'easy' | 'medium' | 'hard', 
    matchType: MatchType,
    preferences?: Partial<MatchPreferences>
  ): Promise<string | null> {
    // Remove user from queue if already present
    this.removeFromQueue(userId)
    
    // Get player's skill rating
    const playerStats = await this.calculateSkillRating(userId)
    
    const defaultPreferences: MatchPreferences = {
      maxSkillDifference: 100,
      maxWaitTime: 60000, // 1 minute
      preferredOpponentLevel: 'similar'
    }

    // Add to queue
    this.queue.push({
      userId,
      difficulty,
      matchType,
      timestamp: new Date(),
      skillRating: playerStats.skillRating,
      preferences: { ...defaultPreferences, ...preferences }
    })

    // Try to find a match immediately
    return this.findSkillBasedMatch(userId)
  }

  /**
   * Add player to simple FCFS queue
   */
  private static async addToSimpleQueue(
    userId: string,
    difficulty: 'easy' | 'medium' | 'hard',
    matchType: MatchType
  ): Promise<string | null> {
    // Remove user from both queues if already present
    this.removeFromQueue(userId)
    
    // Add to simple queue
    this.simpleQueue.push({
      userId,
      difficulty,
      matchType,
      timestamp: new Date()
    })

    // Try to find a match immediately using FCFS
    return this.findFCFSMatch(userId)
  }

  /**
   * Find match using first-come-first-serve basis
   */
  private static async findFCFSMatch(userId: string): Promise<string | null> {
    const userEntry = this.simpleQueue.find(entry => entry.userId === userId)
    if (!userEntry) return null

    // Find the first opponent with same difficulty and match type
    const opponent = this.simpleQueue.find(entry => 
      entry.userId !== userId &&
      entry.difficulty === userEntry.difficulty &&
      entry.matchType === userEntry.matchType
    )

    if (opponent) {
      // Remove both users from queue
      this.removeFromQueue(userId)
      this.removeFromQueue(opponent.userId)

      // Create match
      const matchId = await this.createSimpleMatch(userEntry, opponent)
      return matchId
    }

    return null
  }

  /**
   * Create a simple FCFS match
   */
  private static async createSimpleMatch(
    player1: SimpleQueueEntry, 
    player2: SimpleQueueEntry
  ): Promise<string> {
    try {
      const puzzleData = generatePuzzle(player1.difficulty)
      const sudokuGrid = puzzleData.puzzle
      const solution = puzzleData.solution

      const match = await prisma.match.create({
        data: {
          type: player1.matchType,
          entryFee: 0, // Free multiplayer
          prizePool: 0,
          sudokuSeed: `${Date.now()}-${player1.userId}-${player2.userId}`,
          sudokuGrid: JSON.stringify(sudokuGrid),
          solution: JSON.stringify(solution),
          player1Id: player1.userId,
          player2Id: player2.userId,
          status: 'WAITING'
        }
      })

      console.log(`FCFS match created: ${match.id}`, {
        player1: player1.userId,
        player2: player2.userId,
        difficulty: player1.difficulty
      })

      return match.id
    } catch (error) {
      console.error('Error creating FCFS match:', error)
      throw new Error('Failed to create match')
    }
  }

  /**
   * Calculate player skill rating based on match history
   */
  static async calculateSkillRating(userId: string): Promise<PlayerStats> {
    const recentMatches = await prisma.match.findMany({
      where: {
        OR: [
          { player1Id: userId },
          { player2Id: userId }
        ],
        status: 'FINISHED'
      },
      orderBy: { endedAt: 'desc' },
      take: 50
    })

    if (recentMatches.length === 0) {
      return {
        userId,
        skillRating: 1000, // Starting rating
        gamesPlayed: 0,
        winRate: 0,
        averageTime: 0,
        recentPerformance: []
      }
    }

    const wins = recentMatches.filter(match => match.winnerId === userId).length
    const winRate = wins / recentMatches.length

    // Calculate average completion time
    const completedTimes = recentMatches
      .filter(match => match.startedAt && match.endedAt)
      .map(match => {
        const duration = new Date(match.endedAt!).getTime() - new Date(match.startedAt!).getTime()
        return duration / 1000 // Convert to seconds
      })

    const averageTime = completedTimes.length > 0 
      ? completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length 
      : 300 // Default 5 minutes

    // Recent performance trend (last 10 games)
    const recentPerformance = recentMatches
      .slice(0, 10)
      .map(match => match.winnerId === userId ? 1 : 0)

    // ELO-style rating calculation
    let skillRating = 1000
    for (const match of recentMatches.reverse()) {
      const isWin = match.winnerId === userId
      const expectedScore = this.getExpectedScore(skillRating, 1000) // Assume opponent rating 1000 for base calculation
      const actualScore = isWin ? 1 : 0
      const k = 32 // K-factor
      
      skillRating += k * (actualScore - expectedScore)
    }

    // Adjust for time performance (faster completion = higher skill)
    const timeMultiplier = Math.max(0.8, Math.min(1.2, 300 / averageTime))
    skillRating *= timeMultiplier

    return {
      userId,
      skillRating: Math.round(skillRating),
      gamesPlayed: recentMatches.length,
      winRate,
      averageTime,
      recentPerformance
    }
  }

  /**
   * Find the best skill-matched opponent
   */
  static async findSkillBasedMatch(userId: string): Promise<string | null> {
    const userEntry = this.queue.find(entry => entry.userId === userId)
    if (!userEntry) return null

    const waitTime = Date.now() - userEntry.timestamp.getTime()
    
    // Expand skill search range based on wait time
    const skillExpansion = Math.floor(waitTime / 10000) * this.SKILL_EXPANSION_RATE
    const maxSkillDifference = userEntry.preferences.maxSkillDifference + skillExpansion

    // Find potential opponents
    const opponents = this.queue.filter(entry => 
      entry.userId !== userId &&
      entry.difficulty === userEntry.difficulty &&
      entry.matchType === userEntry.matchType &&
      Math.abs(entry.skillRating - userEntry.skillRating) <= maxSkillDifference
    )

    if (opponents.length > 0) {
      // Sort opponents by skill compatibility
      const sortedOpponents = opponents.sort((a, b) => {
        const skillDiffA = Math.abs(a.skillRating - userEntry.skillRating)
        const skillDiffB = Math.abs(b.skillRating - userEntry.skillRating)
        
        // Prefer opponents based on preference
        const preferenceScoreA = this.getPreferenceScore(userEntry, a)
        const preferenceScoreB = this.getPreferenceScore(userEntry, b)
        
        return (skillDiffA + preferenceScoreA) - (skillDiffB + preferenceScoreB)
      })

      const opponent = sortedOpponents[0]
      
      // Remove both users from queue
      this.removeFromQueue(userId)
      this.removeFromQueue(opponent.userId)

      // Create match
      const matchId = await this.createSkillBasedMatch(userEntry, opponent)
      return matchId
    }

    // If waited too long, expand criteria or match with anyone
    if (waitTime > userEntry.preferences.maxWaitTime) {
      const anyOpponent = this.queue.find(entry => 
        entry.userId !== userId &&
        entry.difficulty === userEntry.difficulty &&
        entry.matchType === userEntry.matchType
      )

      if (anyOpponent) {
        this.removeFromQueue(userId)
        this.removeFromQueue(anyOpponent.userId)
        const matchId = await this.createSkillBasedMatch(userEntry, anyOpponent)
        return matchId
      }
    }

    return null
  }

  /**
   * Calculate preference compatibility score
   */
  private static getPreferenceScore(user: MatchmakingQueue, opponent: MatchmakingQueue): number {
    const skillDiff = opponent.skillRating - user.skillRating
    
    switch (user.preferences.preferredOpponentLevel) {
      case 'higher':
        return skillDiff > 0 ? -skillDiff : skillDiff * 2
      case 'lower':
        return skillDiff < 0 ? skillDiff : -skillDiff * 2
      case 'similar':
        return Math.abs(skillDiff)
      case 'any':
      default:
        return 0
    }
  }

  /**
   * Get expected score for ELO calculation
   */
  private static getExpectedScore(ratingA: number, ratingB: number): number {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
  }

  /**
   * Create a skill-balanced match
   */
  private static async createSkillBasedMatch(player1: MatchmakingQueue, player2: MatchmakingQueue): Promise<string> {
    try {
      // Generate appropriate difficulty puzzle based on players' skills
      const avgSkill = (player1.skillRating + player2.skillRating) / 2
      const adjustedDifficulty = this.getAdjustedDifficulty(player1.difficulty, avgSkill)
      
      const puzzleData = generatePuzzle(adjustedDifficulty)
      const sudokuGrid = puzzleData.puzzle
      const solution = puzzleData.solution

      const match = await prisma.match.create({
        data: {
          type: player1.matchType,
          entryFee: 0, // Free multiplayer
          prizePool: 0,
          sudokuSeed: `${Date.now()}-${player1.userId}-${player2.userId}`,
          sudokuGrid: JSON.stringify(sudokuGrid),
          solution: JSON.stringify(solution),
          player1Id: player1.userId,
          player2Id: player2.userId,
          status: 'WAITING'
        }
      })

      // Log match creation for analytics
      console.log(`Skill-based match created: ${match.id}`, {
        player1Skill: player1.skillRating,
        player2Skill: player2.skillRating,
        skillDifference: Math.abs(player1.skillRating - player2.skillRating),
        difficulty: adjustedDifficulty
      })

      return match.id
    } catch (error) {
      console.error('Error creating skill-based match:', error)
      throw new Error('Failed to create match')
    }
  }

  /**
   * Adjust puzzle difficulty based on average skill level
   */
  private static getAdjustedDifficulty(baseDifficulty: string, avgSkill: number): 'easy' | 'medium' | 'hard' {
    if (avgSkill < 800) return 'easy'
    if (avgSkill < 1200) return baseDifficulty as 'easy' | 'medium' | 'hard'
    if (avgSkill < 1600) return baseDifficulty === 'easy' ? 'medium' : baseDifficulty as 'medium' | 'hard'
    return 'hard'
  }

  /**
   * Get detailed queue status with skill information
   */
  static getAdvancedQueueStatus(userId: string) {
    const entry = this.queue.find(e => e.userId === userId)
    if (!entry) return null

    const waitTime = Date.now() - entry.timestamp.getTime()
    const skillExpansion = Math.floor(waitTime / 10000) * this.SKILL_EXPANSION_RATE
    const currentSkillRange = entry.preferences.maxSkillDifference + skillExpansion

    // Count potential opponents
    const potentialOpponents = this.queue.filter(other => 
      other.userId !== userId &&
      other.difficulty === entry.difficulty &&
      other.matchType === entry.matchType &&
      Math.abs(other.skillRating - entry.skillRating) <= currentSkillRange
    ).length

    return {
      position: this.queue.indexOf(entry) + 1,
      waitTime,
      skillRating: entry.skillRating,
      currentSkillRange,
      potentialOpponents,
      estimatedTime: potentialOpponents > 0 ? 5000 : Math.min(60000, waitTime + 10000)
    }
  }

  /**
   * Update player's skill rating after match completion
   */
  static async updateSkillRating(matchId: string) {
    try {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        include: {
          player1: true,
          player2: true
        }
      })

      if (!match || !match.player2 || match.status !== 'FINISHED') {
        return
      }

      // Get current skill ratings
      const player1Stats = await this.calculateSkillRating(match.player1Id)
      const player2Stats = await this.calculateSkillRating(match.player2!.id)

      // Calculate new ratings using ELO system
      const k = 32 // K-factor
      const expectedScore1 = this.getExpectedScore(player1Stats.skillRating, player2Stats.skillRating)
      const expectedScore2 = this.getExpectedScore(player2Stats.skillRating, player1Stats.skillRating)

      const actualScore1 = match.winnerId === match.player1Id ? 1 : 0
      const actualScore2 = match.winnerId === match.player2Id ? 1 : 0

      const newRating1 = player1Stats.skillRating + k * (actualScore1 - expectedScore1)
      const newRating2 = player2Stats.skillRating + k * (actualScore2 - expectedScore2)

      // In a real application, you'd store these ratings in the database
      console.log(`Skill ratings updated for match ${matchId}:`, {
        player1: { old: player1Stats.skillRating, new: Math.round(newRating1) },
        player2: { old: player2Stats.skillRating, new: Math.round(newRating2) }
      })

    } catch (error) {
      console.error('Error updating skill ratings:', error)
    }
  }

  static removeFromQueue(userId: string) {
    this.queue = this.queue.filter(entry => entry.userId !== userId)
  }

  static getQueueStatus(userId: string) {
    return this.getAdvancedQueueStatus(userId)
  }

  // Clean up old queue entries
  static cleanupQueue() {
    const now = Date.now()
    this.queue = this.queue.filter(entry => 
      now - entry.timestamp.getTime() < this.MATCH_TIMEOUT
    )
  }
}

// Legacy compatibility
export const MatchmakingService = SkillBasedMatchmaking

// Clean queue every 30 seconds
setInterval(() => {
  SkillBasedMatchmaking.cleanupQueue()
}, 30000)
