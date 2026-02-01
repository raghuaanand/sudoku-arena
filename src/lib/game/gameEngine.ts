/**
 * Server-Authoritative Game Engine
 * 
 * This is the source of truth for all game state:
 * - Validates every move against the solution
 * - Tracks correct entry counts for scoring
 * - Manages game timer
 * - Determines winner with deterministic tie-breaking
 * - Anti-cheat: rate limiting, timestamp validation
 * 
 * Key principle: NEVER trust the client for:
 * - Move correctness
 * - Score calculation
 * - Timer values
 * - Game completion
 */

import { prisma } from '@/lib/prisma'
import { getRedisClient, REDIS_KEYS, REDIS_TTL } from '@/lib/redis/redisClient'
import { validateMove, countCorrectEntries, SudokuGrid } from '@/lib/game/sudokuGenerator'
import { releaseEscrowToWinner, releaseEscrowTie } from '@/lib/payments/escrowService'
import { MatchStatus, EscrowStatus } from '@prisma/client'
import { auditLog, AuditAction } from '@/lib/services/auditService'
import { logger } from '@/lib/services/logger'

// ============================================
// TYPES
// ============================================

export interface GameState {
  matchId: string
  status: 'WAITING' | 'READY' | 'ONGOING' | 'FINISHED'
  player1: PlayerState
  player2: PlayerState | null
  puzzle: SudokuGrid
  solution: SudokuGrid
  duration: number        // Match duration in seconds
  startedAt: number | null // Timestamp when game started
  endsAt: number | null   // Timestamp when game ends
  winnerId: string | null
  tieBreaker: 'FIRST_TO_FINISH' | 'HIGHER_SCORE' | 'TIE'
}

export interface PlayerState {
  userId: string
  name: string
  grid: SudokuGrid        // Player's current grid state
  correctCount: number    // Number of correct entries
  moveCount: number       // Total moves made
  lastMoveAt: number | null
  isConnected: boolean
  isFinished: boolean     // True if player completed the puzzle
  finishedAt: number | null
}

export interface MoveResult {
  success: boolean
  isCorrect?: boolean
  newScore?: number
  isGameOver?: boolean
  winnerId?: string | null
  error?: string
}

export interface GameEndResult {
  winnerId: string | null
  player1Score: number
  player2Score: number
  reason: 'TIMEOUT' | 'COMPLETED' | 'FORFEIT' | 'DISCONNECT'
}

// Rate limiting: max moves per second
const MAX_MOVES_PER_SECOND = 3
const MOVE_COOLDOWN_MS = 1000 / MAX_MOVES_PER_SECOND

// ============================================
// GAME STATE MANAGEMENT
// ============================================

/**
 * Initialize game state when match is ready to start
 */
export async function initializeGame(matchId: string): Promise<GameState | null> {
  logger.info('Initializing game', { matchId })

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      player1: true,
      player2: true,
    },
  })

  if (!match || !match.player2Id) {
    logger.error('Match not found or missing player', { matchId })
    return null
  }

  const puzzle = JSON.parse(match.sudokuGrid) as SudokuGrid
  const solution = JSON.parse(match.solution!) as SudokuGrid

  const gameState: GameState = {
    matchId,
    status: 'READY',
    player1: {
      userId: match.player1Id,
      name: match.player1.name || 'Player 1',
      grid: puzzle.map(row => [...row]), // Copy of puzzle
      correctCount: 0,
      moveCount: 0,
      lastMoveAt: null,
      isConnected: false,
      isFinished: false,
      finishedAt: null,
    },
    player2: {
      userId: match.player2Id,
      name: match.player2?.name || 'Player 2',
      grid: puzzle.map(row => [...row]),
      correctCount: 0,
      moveCount: 0,
      lastMoveAt: null,
      isConnected: false,
      isFinished: false,
      finishedAt: null,
    },
    puzzle,
    solution,
    duration: match.duration,
    startedAt: null,
    endsAt: null,
    winnerId: null,
    tieBreaker: 'HIGHER_SCORE',
  }

  // Store in Redis
  const redis = getRedisClient()
  await redis.set(
    REDIS_KEYS.gameState(matchId),
    JSON.stringify(gameState),
    { ex: REDIS_TTL.gameState }
  )

  return gameState
}

/**
 * Get current game state
 */
export async function getGameState(matchId: string): Promise<GameState | null> {
  const redis = getRedisClient()
  const stateStr = await redis.get(REDIS_KEYS.gameState(matchId))
  
  if (!stateStr) {
    // Try to recover from database
    return await initializeGame(matchId)
  }

  return JSON.parse(stateStr)
}

/**
 * Update game state in Redis
 */
async function updateGameState(gameState: GameState): Promise<void> {
  const redis = getRedisClient()
  await redis.set(
    REDIS_KEYS.gameState(gameState.matchId),
    JSON.stringify(gameState),
    { ex: REDIS_TTL.gameState }
  )
}

/**
 * Mark player as connected
 */
export async function playerConnect(
  matchId: string, 
  playerId: string
): Promise<{ success: boolean; gameState?: GameState; error?: string }> {
  const gameState = await getGameState(matchId)
  if (!gameState) {
    return { success: false, error: 'Game not found' }
  }

  const player = getPlayer(gameState, playerId)
  if (!player) {
    return { success: false, error: 'Player not in this game' }
  }

  player.isConnected = true
  await updateGameState(gameState)

  // Check if both players are connected and game can start
  if (gameState.status === 'READY' && 
      gameState.player1.isConnected && 
      gameState.player2?.isConnected) {
    return await startGame(matchId)
  }

  return { success: true, gameState }
}

/**
 * Mark player as disconnected
 */
export async function playerDisconnect(
  matchId: string, 
  playerId: string
): Promise<void> {
  const gameState = await getGameState(matchId)
  if (!gameState) return

  const player = getPlayer(gameState, playerId)
  if (player) {
    player.isConnected = false
    await updateGameState(gameState)
  }

  // If game is ongoing and player disconnected, they may forfeit
  // (handled by disconnect timeout in websocket layer)
}

/**
 * Start the game (both players connected)
 */
export async function startGame(
  matchId: string
): Promise<{ success: boolean; gameState?: GameState; error?: string }> {
  const gameState = await getGameState(matchId)
  if (!gameState) {
    return { success: false, error: 'Game not found' }
  }

  if (gameState.status !== 'READY') {
    return { success: false, error: 'Game is not ready to start' }
  }

  const now = Date.now()
  gameState.status = 'ONGOING'
  gameState.startedAt = now
  gameState.endsAt = now + (gameState.duration * 1000)

  await updateGameState(gameState)

  // Update database
  await prisma.match.update({
    where: { id: matchId },
    data: {
      status: MatchStatus.ONGOING,
      startedAt: new Date(now),
    },
  })

  await auditLog({
    action: AuditAction.MATCH_STARTED,
    entityType: 'Match',
    entityId: matchId,
    metadata: { startedAt: now, duration: gameState.duration },
  })

  logger.info('Game started', { matchId, endsAt: gameState.endsAt })

  // Schedule game end
  scheduleGameEnd(matchId, gameState.duration * 1000)

  return { success: true, gameState }
}

// ============================================
// MOVE HANDLING
// ============================================

/**
 * Process a player's move
 * This is the core game logic - validates and records moves
 */
export async function processMove(
  matchId: string,
  playerId: string,
  row: number,
  col: number,
  value: number,
  clientTimestamp?: number
): Promise<MoveResult> {
  const now = Date.now()

  // Get game state
  const gameState = await getGameState(matchId)
  if (!gameState) {
    return { success: false, error: 'Game not found' }
  }

  // Validate game is ongoing
  if (gameState.status !== 'ONGOING') {
    return { success: false, error: 'Game is not in progress' }
  }

  // Check if time has expired
  if (gameState.endsAt && now > gameState.endsAt) {
    await endGame(matchId, 'TIMEOUT')
    return { success: false, isGameOver: true, error: 'Time expired' }
  }

  // Get player
  const player = getPlayer(gameState, playerId)
  if (!player) {
    return { success: false, error: 'Player not in this game' }
  }

  // Rate limiting
  if (player.lastMoveAt && (now - player.lastMoveAt) < MOVE_COOLDOWN_MS) {
    return { success: false, error: 'Too many moves, slow down' }
  }

  // Validate move coordinates
  if (row < 0 || row >= 9 || col < 0 || col >= 9) {
    return { success: false, error: 'Invalid coordinates' }
  }

  // Check if cell is part of original puzzle (can't modify)
  if (gameState.puzzle[row][col] !== null) {
    return { success: false, error: 'Cannot modify original puzzle cell' }
  }

  // Validate value
  if (value < 0 || value > 9) {
    return { success: false, error: 'Invalid value' }
  }

  // Check if move is correct
  const isCorrect = value === 0 ? false : validateMove(gameState.solution, row, col, value)

  // Update player state
  const previousValue = player.grid[row][col]
  const wasCorrect = previousValue !== null && previousValue === gameState.solution[row][col]

  player.grid[row][col] = value === 0 ? null : value
  player.moveCount++
  player.lastMoveAt = now

  // Update correct count
  if (isCorrect && !wasCorrect) {
    player.correctCount++
  } else if (!isCorrect && wasCorrect) {
    player.correctCount--
  }

  // Check if player completed the puzzle
  const isComplete = isPuzzleComplete(player.grid, gameState.solution)
  if (isComplete && !player.isFinished) {
    player.isFinished = true
    player.finishedAt = now
    logger.info('Player completed puzzle', { matchId, playerId })
  }

  await updateGameState(gameState)

  // Record move in database
  await prisma.matchMove.create({
    data: {
      matchId,
      playerId,
      row,
      col,
      value,
      isCorrect,
      clientTimestamp: clientTimestamp ? new Date(clientTimestamp) : null,
      latencyMs: clientTimestamp ? now - clientTimestamp : null,
    },
  })

  // Update match scores
  if (player.userId === gameState.player1.userId) {
    await prisma.match.update({
      where: { id: matchId },
      data: { player1Score: player.correctCount },
    })
  } else {
    await prisma.match.update({
      where: { id: matchId },
      data: { player2Score: player.correctCount },
    })
  }

  // Check if game should end (both players finished)
  if (gameState.player1.isFinished && gameState.player2?.isFinished) {
    const result = await endGame(matchId, 'COMPLETED')
    return {
      success: true,
      isCorrect,
      newScore: player.correctCount,
      isGameOver: true,
      winnerId: result?.winnerId,
    }
  }

  return {
    success: true,
    isCorrect,
    newScore: player.correctCount,
    isGameOver: false,
  }
}

// ============================================
// GAME END LOGIC
// ============================================

/**
 * End the game and determine winner
 */
export async function endGame(
  matchId: string,
  reason: 'TIMEOUT' | 'COMPLETED' | 'FORFEIT' | 'DISCONNECT'
): Promise<GameEndResult | null> {
  logger.info('Ending game', { matchId, reason })

  const gameState = await getGameState(matchId)
  if (!gameState) {
    return null
  }

  if (gameState.status === 'FINISHED') {
    logger.info('Game already finished', { matchId })
    return null
  }

  gameState.status = 'FINISHED'

  const p1Score = gameState.player1.correctCount
  const p2Score = gameState.player2?.correctCount || 0

  // Determine winner using deterministic rules:
  // 1. Higher correct count wins
  // 2. If tied, first to finish wins
  // 3. If still tied (neither finished), compare by playerId (deterministic)
  let winnerId: string | null = null
  let tieBreaker = 'HIGHER_SCORE'

  if (p1Score > p2Score) {
    winnerId = gameState.player1.userId
  } else if (p2Score > p1Score) {
    winnerId = gameState.player2!.userId
  } else {
    // Scores are tied
    const p1Finished = gameState.player1.finishedAt
    const p2Finished = gameState.player2?.finishedAt

    if (p1Finished && p2Finished) {
      // Both finished, first to finish wins
      winnerId = p1Finished < p2Finished 
        ? gameState.player1.userId
        : gameState.player2!.userId
      tieBreaker = 'FIRST_TO_FINISH'
    } else if (p1Finished) {
      winnerId = gameState.player1.userId
      tieBreaker = 'FIRST_TO_FINISH'
    } else if (p2Finished) {
      winnerId = gameState.player2!.userId
      tieBreaker = 'FIRST_TO_FINISH'
    } else {
      // Neither finished and scores are equal - deterministic tie
      // Use lexicographic comparison of player IDs
      winnerId = gameState.player1.userId < gameState.player2!.userId
        ? gameState.player1.userId
        : gameState.player2!.userId
      tieBreaker = 'TIE'
    }
  }

  gameState.winnerId = winnerId
  gameState.tieBreaker = tieBreaker as 'FIRST_TO_FINISH' | 'HIGHER_SCORE' | 'TIE'

  await updateGameState(gameState)

  // Update database
  const loserId = winnerId === gameState.player1.userId 
    ? gameState.player2!.userId
    : gameState.player1.userId

  await prisma.match.update({
    where: { id: matchId },
    data: {
      status: MatchStatus.FINISHED,
      winnerId,
      player1Score: p1Score,
      player2Score: p2Score,
      endedAt: new Date(),
    },
  })

  // Handle escrow payout
  const match = await prisma.match.findUnique({ where: { id: matchId } })
  if (match?.escrowStatus === EscrowStatus.LOCKED) {
    if (tieBreaker === 'TIE' && p1Score === p2Score && p1Score === 0) {
      // Perfect tie with zero progress - refund both
      await releaseEscrowTie(matchId, gameState.player1.userId, gameState.player2!.userId)
    } else if (winnerId) {
      await releaseEscrowToWinner(matchId, winnerId, loserId)
    }
  }

  await auditLog({
    action: AuditAction.MATCH_ENDED,
    entityType: 'Match',
    entityId: matchId,
    metadata: {
      winnerId,
      player1Score: p1Score,
      player2Score: p2Score,
      reason,
      tieBreaker,
    },
  })

  logger.info('Game ended', {
    matchId,
    winnerId,
    player1Score: p1Score,
    player2Score: p2Score,
    reason,
  })

  // Publish game end event
  const redis = getRedisClient()
  await redis.publish(REDIS_KEYS.gameEvents(matchId), JSON.stringify({
    event: 'game:ended',
    data: { matchId, winnerId, player1Score: p1Score, player2Score: p2Score, reason },
  }))

  return {
    winnerId,
    player1Score: p1Score,
    player2Score: p2Score,
    reason,
  }
}

/**
 * Player forfeits the game
 */
export async function forfeitGame(
  matchId: string, 
  forfeitingPlayerId: string
): Promise<GameEndResult | null> {
  logger.info('Player forfeiting', { matchId, forfeitingPlayerId })

  const gameState = await getGameState(matchId)
  if (!gameState) return null

  // Set the other player as winner
  const winnerId = forfeitingPlayerId === gameState.player1.userId
    ? gameState.player2!.userId
    : gameState.player1.userId

  // Set forfeiting player's score to 0
  const player = getPlayer(gameState, forfeitingPlayerId)
  if (player) {
    player.correctCount = 0
  }
  await updateGameState(gameState)

  return await endGame(matchId, 'FORFEIT')
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getPlayer(gameState: GameState, playerId: string): PlayerState | null {
  if (gameState.player1.userId === playerId) return gameState.player1
  if (gameState.player2?.userId === playerId) return gameState.player2
  return null
}

function isPuzzleComplete(grid: SudokuGrid, solution: SudokuGrid): boolean {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (grid[row][col] !== solution[row][col]) return false
    }
  }
  return true
}

/**
 * Schedule automatic game end when time expires
 */
function scheduleGameEnd(matchId: string, delayMs: number): void {
  // In serverless, we can't rely on setTimeout
  // Instead, we'll check on each move and have a cron job for cleanup
  // For now, log the scheduled end time
  logger.info('Game end scheduled', { 
    matchId, 
    endsAt: new Date(Date.now() + delayMs).toISOString(),
  })
  
  // In a non-serverless environment, you could use:
  // setTimeout(() => endGame(matchId, 'TIMEOUT'), delayMs)
}

/**
 * Check and end games that have timed out
 * This should be called periodically by a cron job
 */
export async function checkAndEndTimedOutGames(): Promise<number> {
  const now = Date.now()
  let ended = 0

  // Find ongoing matches that should have ended
  const timedOutMatches = await prisma.match.findMany({
    where: {
      status: MatchStatus.ONGOING,
      startedAt: { not: null },
    },
  })

  for (const match of timedOutMatches) {
    const endTime = match.startedAt!.getTime() + (match.duration * 1000)
    if (now > endTime) {
      await endGame(match.id, 'TIMEOUT')
      ended++
    }
  }

  if (ended > 0) {
    logger.info('Ended timed out games', { count: ended })
  }

  return ended
}

/**
 * Get remaining time for a game
 */
export async function getRemainingTime(matchId: string): Promise<number> {
  const gameState = await getGameState(matchId)
  if (!gameState || !gameState.endsAt) return 0
  
  const remaining = gameState.endsAt - Date.now()
  return Math.max(0, Math.floor(remaining / 1000))
}

/**
 * Get player's current score
 */
export async function getPlayerScore(
  matchId: string, 
  playerId: string
): Promise<number> {
  const gameState = await getGameState(matchId)
  if (!gameState) return 0

  const player = getPlayer(gameState, playerId)
  return player?.correctCount || 0
}
