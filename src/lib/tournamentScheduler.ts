// Advanced tournament scheduling and automation system
// This module handles automated tournament progression, scheduling, and management

import { PrismaClient, TransactionStatus } from '@prisma/client'

const prisma = new PrismaClient()

export interface TournamentSchedule {
  tournamentId: string
  startTime: Date
  estimatedDuration: number // in minutes
  status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
}

export class TournamentScheduler {
  /**
   * Create and schedule a new tournament
   */
  static async createScheduledTournament(tournamentData: {
    name: string
    entryFee: number
    maxParticipants: number
    startTime: Date
    description?: string
    createdById: string
  }): Promise<string> {
    try {
      const tournament = await prisma.tournament.create({
        data: {
          name: tournamentData.name,
          entryFee: tournamentData.entryFee,
          maxParticipants: tournamentData.maxParticipants,
          startTime: tournamentData.startTime,
          description: tournamentData.description,
          status: 'REGISTRATION_OPEN',
          createdById: tournamentData.createdById
        }
      })

      // Schedule auto-start if needed
      await this.scheduleAutoStart(tournament.id)

      return tournament.id
    } catch (error) {
      console.error('Error creating scheduled tournament:', error)
      throw new Error('Failed to create tournament')
    }
  }

  /**
   * Schedule automatic tournament start
   */
  static async scheduleAutoStart(tournamentId: string): Promise<void> {
    // In a real implementation, this would use a job queue like Bull or Agenda
    console.log(`Scheduled auto-start for tournament ${tournamentId}`)
  }

  /**
   * Start a tournament automatically
   */
  static async startTournament(tournamentId: string): Promise<void> {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        include: { participants: { include: { user: true } } }
      })

      if (!tournament || tournament.status !== 'REGISTRATION_OPEN') {
        return
      }

      if (tournament.participants.length < 4) {
        await this.cancelTournament(tournamentId, 'Insufficient players')
        return
      }

      // Start the tournament
      await prisma.tournament.update({
        where: { id: tournamentId },
        data: { 
          status: 'IN_PROGRESS',
          endTime: new Date()
        }
      })

      console.log(`Tournament ${tournamentId} started automatically with ${tournament.participants.length} players`)
    } catch (error) {
      console.error('Error starting tournament:', error)
    }
  }

  /**
   * Handle match completion in tournament
   */
  static async handleMatchCompletion(matchId: string): Promise<void> {
    try {
      const match = await prisma.match.findUnique({
        where: { id: matchId }
      })

      if (!match) {
        return
      }

      // Check if tournament is complete
      // This would need additional match tracking logic

      console.log(`Match ${matchId} completed`)
    } catch (error) {
      console.error('Error handling match completion:', error)
    }
  }

  /**
   * Complete tournament and distribute prizes
   */
  static async completeTournament(tournamentId: string): Promise<void> {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId }
      })

      if (!tournament) return

      // Mark tournament as completed
      await prisma.tournament.update({
        where: { id: tournamentId },
        data: { 
          status: 'COMPLETED',
          endTime: new Date()
        }
      })

      await this.distributePrizes(tournamentId)

      console.log(`Tournament ${tournamentId} completed`)
    } catch (error) {
      console.error('Error completing tournament:', error)
    }
  }

  /**
   * Distribute prize money to winners
   */
  static async distributePrizes(tournamentId: string): Promise<void> {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId }
      })

      if (!tournament || !tournament.winnerId) return

      // Calculate prize amounts (simplified)
      const totalPrize = tournament.entryFee * 10 // Simplified calculation

      // Get current wallet balance
      const wallet = await prisma.wallet.findUnique({
        where: { userId: tournament.winnerId }
      })

      const balanceBefore = wallet?.balance || 0
      const balanceAfter = balanceBefore + totalPrize

      // Award winner
      await prisma.transaction.create({
        data: {
          userId: tournament.winnerId,
          amount: totalPrize,
          type: 'MATCH_WIN',
          description: `Tournament ${tournament.name} - Winner Prize`,
          status: TransactionStatus.COMPLETED,
          balanceBefore,
          balanceAfter
        }
      })

      // Update user wallet
      await prisma.wallet.upsert({
        where: { userId: tournament.winnerId },
        create: {
          userId: tournament.winnerId,
          balance: totalPrize
        },
        update: {
          balance: {
            increment: totalPrize
          }
        }
      })

      console.log(`Distributed prizes for tournament ${tournamentId}`)
    } catch (error) {
      console.error('Error distributing prizes:', error)
    }
  }

  /**
   * Cancel tournament and refund players
   */
  static async cancelTournament(tournamentId: string, reason: string): Promise<void> {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        include: { participants: true }
      })

      if (!tournament) return

      // Mark tournament as cancelled
      await prisma.tournament.update({
        where: { id: tournamentId },
        data: { 
          status: 'CANCELLED',
          endTime: new Date()
        }
      })

      // Refund all participants
      for (const participant of tournament.participants) {
        // Get current wallet balance
        const wallet = await prisma.wallet.findUnique({
          where: { userId: participant.userId }
        })

        const balanceBefore = wallet?.balance || 0
        const balanceAfter = balanceBefore + tournament.entryFee

        await prisma.transaction.create({
          data: {
            userId: participant.userId,
            amount: tournament.entryFee,
            type: 'ADMIN_CREDIT',
            description: `Tournament ${tournament.name} - Cancelled Refund: ${reason}`,
            status: TransactionStatus.COMPLETED,
            balanceBefore,
            balanceAfter
          }
        })

        // Update user wallet
        await prisma.wallet.upsert({
          where: { userId: participant.userId },
          create: {
            userId: participant.userId,
            balance: tournament.entryFee
          },
          update: {
            balance: {
              increment: tournament.entryFee
            }
          }
        })
      }

      console.log(`Tournament ${tournamentId} cancelled: ${reason}`)
    } catch (error) {
      console.error('Error cancelling tournament:', error)
    }
  }

  /**
   * Check if all matches in current round are complete
   */
  static async checkRoundCompletion(tournamentId: string): Promise<boolean> {
    try {
      // This would need proper match tracking in the database
      // For now, return true as a placeholder
      console.log(`Checking round completion for tournament ${tournamentId}`)
      return true
    } catch (error) {
      console.error('Error checking round completion:', error)
      return false
    }
  }

  /**
   * Get tournament schedule for display
   */
  static async getTournamentSchedule(tournamentId: string): Promise<TournamentSchedule | null> {
    try {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId }
      })

      if (!tournament) return null

      return {
        tournamentId: tournament.id,
        startTime: tournament.startTime,
        estimatedDuration: 120, // 2 hours estimated
        status: tournament.status === 'REGISTRATION_OPEN' ? 'SCHEDULED' :
                tournament.status === 'IN_PROGRESS' ? 'ACTIVE' :
                tournament.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED'
      }
    } catch (error) {
      console.error('Error getting tournament schedule:', error)
      return null
    }
  }

  /**
   * Get upcoming tournaments that need to be started
   */
  static async getUpcomingTournaments(): Promise<string[]> {
    try {
      const now = new Date()
      const upcoming = await prisma.tournament.findMany({
        where: {
          status: 'REGISTRATION_OPEN',
          startTime: {
            lte: now
          }
        },
        select: { id: true }
      })

      return upcoming.map(t => t.id)
    } catch (error) {
      console.error('Error getting upcoming tournaments:', error)
      return []
    }
  }

  /**
   * Process all scheduled tournament events
   */
  static async processScheduledEvents(): Promise<void> {
    try {
      const upcomingTournaments = await this.getUpcomingTournaments()
      
      for (const tournamentId of upcomingTournaments) {
        await this.startTournament(tournamentId)
      }
    } catch (error) {
      console.error('Error processing scheduled events:', error)
    }
  }
}

// Export tournament automation utilities
export const TournamentAutomation = {
  // Start background scheduler (would use a job queue in production)
  startScheduler(): void {
    console.log('Tournament scheduler started')
    // In production: set up recurring job to call processScheduledEvents()
  },

  // Stop background scheduler
  stopScheduler(): void {
    console.log('Tournament scheduler stopped')
  }
}
