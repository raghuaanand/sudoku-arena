// Game scoring and completion logic
import { prisma } from '@/lib/prisma'
import { TransactionStatus } from '@prisma/client'
import { MatchStatus } from '@/types'

export interface GameScore {
  playerId: string
  timeElapsed: number
  movesCount: number
  hintsUsed: number
  errorsCount: number
  isComplete: boolean
  finalScore: number
}

export interface GameCompletion {
  matchId: string
  winnerId: string | null
  player1Score: GameScore
  player2Score: GameScore
  completedAt: Date
}

export class GameScoringService {
  // Calculate score based on time, moves, hints, and errors
  static calculateScore(
    timeElapsed: number, // in seconds
    movesCount: number,
    hintsUsed: number,
    errorsCount: number,
    isComplete: boolean
  ): number {
    if (!isComplete) return 0

    const baseScore = 10000
    
    // Time penalty: lose 10 points per minute
    const timePenalty = Math.floor(timeElapsed / 60) * 10
    
    // Move efficiency: lose points for excessive moves
    const optimalMoves = 81 // Theoretical minimum moves
    const movePenalty = Math.max(0, (movesCount - optimalMoves) * 5)
    
    // Hint penalty: -100 points per hint
    const hintPenalty = hintsUsed * 100
    
    // Error penalty: -50 points per error
    const errorPenalty = errorsCount * 50
    
    const finalScore = Math.max(0, baseScore - timePenalty - movePenalty - hintPenalty - errorPenalty)
    
    return Math.round(finalScore)
  }

  // Check if game is complete and determine winner
  static async checkGameCompletion(matchId: string): Promise<GameCompletion | null> {
    try {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        include: {
          player1: true,
          player2: true
        }
      })

      if (!match || match.status !== 'ONGOING') {
        return null
      }

      // Get game states for both players (this would come from real-time tracking)
      const player1State = await this.getPlayerGameState(match.player1Id, matchId)
      const player2State = match.player2Id ? await this.getPlayerGameState(match.player2Id, matchId) : null

      // Check if either player completed the puzzle
      if (player1State?.isComplete || player2State?.isComplete) {
        return this.determineWinner(match, player1State, player2State)
      }

      return null
    } catch (error) {
      console.error('Error checking game completion:', error)
      return null
    }
  }

  private static async getPlayerGameState(playerId: string, matchId: string): Promise<GameScore | null> {
    // In a real implementation, this would fetch from Redis or game state storage
    // For now, return mock data
    return {
      playerId,
      timeElapsed: Math.floor(Math.random() * 1800), // 0-30 minutes
      movesCount: Math.floor(Math.random() * 200) + 81,
      hintsUsed: Math.floor(Math.random() * 5),
      errorsCount: Math.floor(Math.random() * 10),
      isComplete: Math.random() > 0.7, // 30% chance of completion
      finalScore: 0
    }
  }

  private static async determineWinner(
    match: any,
    player1State: GameScore | null,
    player2State: GameScore | null
  ): Promise<GameCompletion> {
    // Calculate final scores
    if (player1State) {
      player1State.finalScore = this.calculateScore(
        player1State.timeElapsed,
        player1State.movesCount,
        player1State.hintsUsed,
        player1State.errorsCount,
        player1State.isComplete
      )
    }

    if (player2State) {
      player2State.finalScore = this.calculateScore(
        player2State.timeElapsed,
        player2State.movesCount,
        player2State.hintsUsed,
        player2State.errorsCount,
        player2State.isComplete
      )
    }

    // Determine winner
    let winnerId: string | null = null
    
    if (player1State?.isComplete && player2State?.isComplete) {
      // Both completed - higher score wins
      winnerId = player1State.finalScore >= player2State.finalScore 
        ? player1State.playerId 
        : player2State.playerId
    } else if (player1State?.isComplete) {
      winnerId = player1State.playerId
    } else if (player2State?.isComplete) {
      winnerId = player2State.playerId
    }

    // Update match in database
    if (winnerId) {
      await prisma.match.update({
        where: { id: match.id },
        data: {
          winnerId,
          status: 'FINISHED',
          endedAt: new Date()
        }
      })

      // Handle prize distribution for paid matches
      if (match.type === 'MULTIPLAYER_PAID' && match.prize > 0) {
        await this.distributePrize(winnerId, match.prize)
      }
    }

    return {
      matchId: match.id,
      winnerId,
      player1Score: player1State!,
      player2Score: player2State!,
      completedAt: new Date()
    }
  }

  private static async distributePrize(winnerId: string, prizeAmount: number) {
    try {
      // Get current wallet balance
      const wallet = await prisma.wallet.findUnique({
        where: { userId: winnerId }
      })

      const balanceBefore = wallet?.balance || 0
      const balanceAfter = balanceBefore + prizeAmount

      // Add prize to winner's wallet
      await prisma.wallet.upsert({
        where: { userId: winnerId },
        create: {
          userId: winnerId,
          balance: prizeAmount
        },
        update: {
          balance: {
            increment: prizeAmount
          }
        }
      })

      // Record transaction
      await prisma.transaction.create({
        data: {
          userId: winnerId,
          amount: prizeAmount,
          type: 'MATCH_WIN',
          description: `Prize for winning multiplayer match`,
          status: TransactionStatus.COMPLETED,
          balanceBefore,
          balanceAfter
        }
      })
    } catch (error) {
      console.error('Error distributing prize:', error)
    }
  }

  // Validate Sudoku grid completion
  static validateSudokuCompletion(grid: number[][]): boolean {
    // Check if all cells are filled
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (grid[row][col] === 0) return false
      }
    }

    // Check rows
    for (let row = 0; row < 9; row++) {
      const numbers = new Set(grid[row])
      if (numbers.size !== 9 || !this.hasAllNumbers(numbers)) return false
    }

    // Check columns
    for (let col = 0; col < 9; col++) {
      const numbers = new Set<number>()
      for (let row = 0; row < 9; row++) {
        numbers.add(grid[row][col])
      }
      if (numbers.size !== 9 || !this.hasAllNumbers(numbers)) return false
    }

    // Check 3x3 boxes
    for (let boxRow = 0; boxRow < 3; boxRow++) {
      for (let boxCol = 0; boxCol < 3; boxCol++) {
        const numbers = new Set<number>()
        for (let row = boxRow * 3; row < (boxRow + 1) * 3; row++) {
          for (let col = boxCol * 3; col < (boxCol + 1) * 3; col++) {
            numbers.add(grid[row][col])
          }
        }
        if (numbers.size !== 9 || !this.hasAllNumbers(numbers)) return false
      }
    }

    return true
  }

  private static hasAllNumbers(numbers: Set<number>): boolean {
    for (let i = 1; i <= 9; i++) {
      if (!numbers.has(i)) return false
    }
    return true
  }

  // Real-time progress tracking
  static async updatePlayerProgress(
    playerId: string,
    matchId: string,
    grid: number[][],
    timeElapsed: number,
    movesCount: number,
    hintsUsed: number,
    errorsCount: number
  ) {
    const isComplete = this.validateSudokuCompletion(grid)
    
    // In production, store this in Redis for real-time access
    const gameState: GameScore = {
      playerId,
      timeElapsed,
      movesCount,
      hintsUsed,
      errorsCount,
      isComplete,
      finalScore: isComplete ? this.calculateScore(timeElapsed, movesCount, hintsUsed, errorsCount, true) : 0
    }

    // Check for game completion
    if (isComplete) {
      return await this.checkGameCompletion(matchId)
    }

    return null
  }
}
