/**
 * Production WebSocket Server Handler
 * 
 * This module provides the Socket.IO event handlers that integrate
 * with the authoritative game engine. It's designed to work with:
 * - Custom Node.js server (development)
 * - Edge-compatible polling fallback (Vercel)
 * 
 * Key Features:
 * - Player connection/disconnection handling
 * - Move relay and validation
 * - Real-time game state synchronization
 * - Chat functionality
 * - Disconnect timeout handling
 */

import { Server as SocketServer, Socket } from 'socket.io'
import { 
  initializeGame, 
  getGameState, 
  playerConnect, 
  playerDisconnect,
  processMove, 
  forfeitGame,
  getRemainingTime 
} from '@/lib/game/gameEngine'
import { getRedisClient, REDIS_KEYS } from '@/lib/redis/redisClient'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/services/logger'

// Disconnect timeout: 30 seconds
const DISCONNECT_TIMEOUT_MS = 30 * 1000

// Track disconnect timers
const disconnectTimers = new Map<string, NodeJS.Timeout>()

// ============================================
// SOCKET.IO SETUP
// ============================================

export function setupSocketHandlers(io: SocketServer): void {
  io.on('connection', (socket: Socket) => {
    logger.debug('Socket connected', { socketId: socket.id })

    // ==========================================
    // JOIN GAME
    // ==========================================
    socket.on('join-game', async (data: { matchId: string; userId: string }) => {
      try {
        const { matchId, userId } = data

        if (!matchId || !userId) {
          socket.emit('error', { message: 'Missing matchId or userId' })
          return
        }

        logger.info('Player joining game', { matchId, userId, socketId: socket.id })

        // Verify player is part of this match
        const match = await prisma.match.findUnique({
          where: { id: matchId },
          include: { player1: true, player2: true },
        })

        if (!match) {
          socket.emit('error', { message: 'Match not found' })
          return
        }

        if (match.player1Id !== userId && match.player2Id !== userId) {
          socket.emit('error', { message: 'Not a participant in this match' })
          return
        }

        // Store user info in socket
        socket.data.matchId = matchId
        socket.data.userId = userId
        socket.data.playerName = match.player1Id === userId 
          ? match.player1.name 
          : match.player2?.name

        // Join the room
        const roomId = `game:${matchId}`
        await socket.join(roomId)

        // Clear any disconnect timer
        clearDisconnectTimer(userId)

        // Track player connection in Redis
        const redis = getRedisClient()
        await redis.set(
          REDIS_KEYS.playerConnection(userId),
          JSON.stringify({ socketId: socket.id, matchId }),
          { ex: 60 }
        )
        await redis.sadd(REDIS_KEYS.gamePlayers(matchId), userId)

        // Initialize or get game state
        let gameState = await getGameState(matchId)
        if (!gameState) {
          gameState = await initializeGame(matchId)
        }

        if (!gameState) {
          socket.emit('error', { message: 'Failed to initialize game' })
          return
        }

        // Mark player as connected and potentially start game
        const connectResult = await playerConnect(matchId, userId)
        if (connectResult.gameState) {
          gameState = connectResult.gameState
        }

        // Send current game state to joining player
        const timeRemaining = await getRemainingTime(matchId)
        const isPlayer1 = userId === gameState.player1.userId

        socket.emit('game-state', {
          matchId,
          status: gameState.status,
          puzzle: gameState.puzzle,
          myGrid: isPlayer1 ? gameState.player1.grid : gameState.player2?.grid,
          myScore: isPlayer1 ? gameState.player1.correctCount : gameState.player2?.correctCount,
          opponentScore: isPlayer1 ? gameState.player2?.correctCount : gameState.player1.correctCount,
          opponentName: isPlayer1 ? gameState.player2?.name : gameState.player1.name,
          duration: gameState.duration,
          timeRemaining,
          isPlayer1,
        })

        // Notify room that player joined
        socket.to(roomId).emit('player-joined', {
          oderId: userId,
          name: socket.data.playerName,
          isConnected: true,
        })

        // If game just started, notify both players
        if (gameState.status === 'ONGOING' && connectResult.success) {
          io.to(roomId).emit('game-started', {
            startedAt: gameState.startedAt,
            endsAt: gameState.endsAt,
            duration: gameState.duration,
          })
        }

        logger.info('Player joined game successfully', { matchId, userId })
      } catch (error) {
        logger.error('Error joining game', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        socket.emit('error', { message: 'Failed to join game' })
      }
    })

    // ==========================================
    // MAKE MOVE
    // ==========================================
    socket.on('make-move', async (data: {
      row: number
      col: number
      value: number
      clientTimestamp?: number
    }) => {
      try {
        const { matchId, userId } = socket.data
        if (!matchId || !userId) {
          socket.emit('error', { message: 'Not in a game' })
          return
        }

        const { row, col, value, clientTimestamp } = data

        // Process move through game engine
        const result = await processMove(matchId, userId, row, col, value, clientTimestamp)

        // Send result to player who made the move
        socket.emit('move-result', {
          row,
          col,
          value,
          isCorrect: result.isCorrect,
          score: result.newScore,
          isGameOver: result.isGameOver,
        })

        // Notify opponent of the move (without revealing if correct)
        socket.to(`game:${matchId}`).emit('opponent-move', {
          score: result.newScore, // Only send score, not the actual move
        })

        // If game is over, notify both players
        if (result.isGameOver) {
          const gameState = await getGameState(matchId)
          socket.to(`game:${matchId}`).emit('game-ended', {
            winnerId: result.winnerId,
            player1Score: gameState?.player1.correctCount || 0,
            player2Score: gameState?.player2?.correctCount || 0,
          })
        }
      } catch (error) {
        logger.error('Error processing move', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        socket.emit('error', { message: 'Failed to process move' })
      }
    })

    // ==========================================
    // CHAT
    // ==========================================
    socket.on('chat-message', async (data: { message: string }) => {
      try {
        const { matchId, userId, playerName } = socket.data
        if (!matchId || !userId) {
          return
        }

        const message = data.message?.trim()
        if (!message || message.length > 500) {
          return
        }

        // Save to database
        await prisma.chatMessage.create({
          data: {
            matchId,
            userId,
            message,
          },
        })

        // Broadcast to room
        io.to(`game:${matchId}`).emit('chat-message', {
          userId,
          name: playerName,
          message,
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        logger.error('Error sending chat message', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })

    // ==========================================
    // FORFEIT
    // ==========================================
    socket.on('forfeit', async () => {
      try {
        const { matchId, userId } = socket.data
        if (!matchId || !userId) {
          return
        }

        logger.info('Player forfeiting', { matchId, userId })

        const result = await forfeitGame(matchId, userId)
        if (result) {
          io.to(`game:${matchId}`).emit('game-ended', {
            winnerId: result.winnerId,
            player1Score: result.player1Score,
            player2Score: result.player2Score,
            reason: 'FORFEIT',
          })
        }
      } catch (error) {
        logger.error('Error forfeiting game', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })

    // ==========================================
    // DISCONNECT
    // ==========================================
    socket.on('disconnect', async () => {
      try {
        const { matchId, userId } = socket.data
        logger.debug('Socket disconnected', { socketId: socket.id, matchId, userId })

        if (!matchId || !userId) {
          return
        }

        // Mark player as disconnected
        await playerDisconnect(matchId, userId)

        // Update Redis
        const redis = getRedisClient()
        await redis.del(REDIS_KEYS.playerConnection(userId))

        // Notify room
        io.to(`game:${matchId}`).emit('player-disconnected', {
          userId,
        })

        // Start disconnect timer - forfeit if not reconnected
        const timer = setTimeout(async () => {
          logger.info('Player disconnect timeout - forfeiting', { matchId, userId })
          
          const gameState = await getGameState(matchId)
          if (gameState?.status === 'ONGOING') {
            const result = await forfeitGame(matchId, userId)
            if (result) {
              io.to(`game:${matchId}`).emit('game-ended', {
                winnerId: result.winnerId,
                player1Score: result.player1Score,
                player2Score: result.player2Score,
                reason: 'DISCONNECT',
              })
            }
          }
          
          disconnectTimers.delete(userId)
        }, DISCONNECT_TIMEOUT_MS)

        disconnectTimers.set(userId, timer)
      } catch (error) {
        logger.error('Error handling disconnect', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })

    // ==========================================
    // HEARTBEAT
    // ==========================================
    socket.on('heartbeat', async () => {
      const { matchId, userId } = socket.data
      if (userId) {
        const redis = getRedisClient()
        await redis.set(
          REDIS_KEYS.playerConnection(userId),
          JSON.stringify({ socketId: socket.id, matchId }),
          { ex: 60 }
        )
      }
      socket.emit('heartbeat-ack')
    })
  })
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function clearDisconnectTimer(userId: string): void {
  const timer = disconnectTimers.get(userId)
  if (timer) {
    clearTimeout(timer)
    disconnectTimers.delete(userId)
  }
}

/**
 * Broadcast game time update to all players
 * Called periodically by game loop
 */
export async function broadcastTimeUpdate(
  io: SocketServer,
  matchId: string,
  timeRemaining: number
): Promise<void> {
  io.to(`game:${matchId}`).emit('time-update', { timeRemaining })
}

/**
 * Broadcast game end to all players
 */
export async function broadcastGameEnd(
  io: SocketServer,
  matchId: string,
  winnerId: string | null,
  player1Score: number,
  player2Score: number,
  reason: string
): Promise<void> {
  io.to(`game:${matchId}`).emit('game-ended', {
    winnerId,
    player1Score,
    player2Score,
    reason,
  })
}
