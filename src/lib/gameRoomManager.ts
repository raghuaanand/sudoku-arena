// Advanced game room management system with real-time features
// Handles multiplayer game sessions, spectator mode, and game state synchronization

import { PrismaClient } from '@prisma/client'
import { Server as SocketServer } from 'socket.io'
// Note: Inlining sudoku validation functions to avoid TypeScript import issues when running with Node.js directly

const prisma = new PrismaClient()

// Inlined validation functions to avoid TypeScript path alias issues
type SudokuGrid = (number | null)[][]

function isValidMove(grid: SudokuGrid, row: number, col: number, num: number): boolean {
  if (!grid || !Array.isArray(grid) || grid.length !== 9) return false
  if (row < 0 || row >= 9 || col < 0 || col >= 9) return false
  if (num < 1 || num > 9) return false

  // Check row
  for (let x = 0; x < 9; x++) {
    if (Array.isArray(grid[row]) && grid[row][x] === num) return false
  }

  // Check column
  for (let x = 0; x < 9; x++) {
    if (Array.isArray(grid[x]) && grid[x][col] === num) return false
  }

  // Check 3x3 box
  const startRow = row - (row % 3)
  const startCol = col - (col % 3)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (Array.isArray(grid[i + startRow]) && grid[i + startRow][j + startCol] === num) return false
    }
  }
  return true
}

function isValidGrid(grid: SudokuGrid): boolean {
  if (!grid || !Array.isArray(grid) || grid.length !== 9) return false
  
  for (let row = 0; row < 9; row++) {
    if (!Array.isArray(grid[row]) || grid[row].length !== 9) return false
    
    for (let col = 0; col < 9; col++) {
      const num = grid[row][col]
      if (num !== null && num !== 0 && num !== undefined) {
        grid[row][col] = null
        const valid = isValidMove(grid, row, col, num as number)
        grid[row][col] = num
        if (!valid) return false
      }
    }
  }
  return true
}

function isComplete(grid: SudokuGrid): boolean {
  if (!grid || !Array.isArray(grid) || grid.length !== 9) return false
  
  for (let row = 0; row < 9; row++) {
    if (!Array.isArray(grid[row]) || grid[row].length !== 9) return false
    
    for (let col = 0; col < 9; col++) {
      if (grid[row][col] === null || grid[row][col] === 0 || grid[row][col] === undefined) {
        return false
      }
    }
  }
  return isValidGrid(grid)
}

export interface GameRoom {
  id: string
  matchId: string
  players: GamePlayer[]
  spectators: string[]
  gameState: GameState
  settings: GameSettings
  status: 'WAITING' | 'STARTING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  createdAt: Date
  startedAt?: Date
  endedAt?: Date
  lastActivity: Date
}

export interface GamePlayer {
  id: string
  name: string
  socketId: string
  isReady: boolean
  isConnected: boolean
  progress: number[][]
  score: number
  moves: number
  hintsUsed: number
  timeSpent: number
  lastMoveAt?: Date
}

export interface GameState {
  puzzle: number[][]
  solution: number[][]
  currentTurn?: string // For turn-based modes
  timeLimit?: number // in seconds
  timeRemaining?: number
  gameMode: 'SIMULTANEOUS' | 'TURN_BASED' | 'SPEED_BATTLE'
  difficulty: 'easy' | 'medium' | 'hard'
}

export interface GameSettings {
  timeLimit: number // in seconds
  hintsAllowed: number
  spectatorMode: boolean
  privateRoom: boolean
  roomCode?: string
  maxSpectators: number
}

export interface GameMove {
  playerId: string
  row: number
  col: number
  value: number | null
  timestamp: Date
  isValid: boolean
}

export class GameRoomManager {
  private static rooms = new Map<string, GameRoom>()
  private static io: SocketServer | null = null

  static setSocketServer(socketServer: SocketServer) {
    this.io = socketServer
  }

  /**
   * Create a new game room
   */
  static async createRoom(
    matchId: string,
    settings: Partial<GameSettings> = {}
  ): Promise<GameRoom> {
    const defaultSettings: GameSettings = {
      timeLimit: 1800, // 30 minutes
      hintsAllowed: 3,
      spectatorMode: true,
      privateRoom: false,
      maxSpectators: 10,
      ...settings
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        player1: true,
        player2: true
      }
    })

    if (!match) {
      throw new Error('Match not found')
    }

    const puzzle = JSON.parse(match.sudokuGrid)
    const solution = match.solution ? JSON.parse(match.solution) : null

    const room: GameRoom = {
      id: `room_${matchId}`,
      matchId,
      players: [],
      spectators: [],
      gameState: {
        puzzle,
        solution,
        gameMode: 'SIMULTANEOUS',
        difficulty: 'medium',
        timeLimit: defaultSettings.timeLimit,
        timeRemaining: defaultSettings.timeLimit
      },
      settings: defaultSettings,
      status: 'WAITING',
      createdAt: new Date(),
      lastActivity: new Date()
    }

    this.rooms.set(room.id, room)
    return room
  }

  /**
   * Join a player to a room
   */
  static async joinRoom(
    roomId: string,
    playerId: string,
    playerName: string,
    socketId: string
  ): Promise<GameRoom> {
    const room = this.rooms.get(roomId)
    if (!room) {
      throw new Error('Room not found')
    }

    // Check if player is already in room
    const existingPlayer = room.players.find(p => p.id === playerId)
    if (existingPlayer) {
      // Reconnecting player
      existingPlayer.socketId = socketId
      existingPlayer.isConnected = true
    } else {
      // New player joining
      if (room.players.length >= 2) {
        throw new Error('Room is full')
      }

      const newPlayer: GamePlayer = {
        id: playerId,
        name: playerName,
        socketId,
        isReady: false,
        isConnected: true,
        progress: room.gameState.puzzle.map(row => [...row]),
        score: 0,
        moves: 0,
        hintsUsed: 0,
        timeSpent: 0
      }

      room.players.push(newPlayer)
    }

    room.lastActivity = new Date()

    // Notify room about player join
    if (this.io) {
      this.io.to(roomId).emit('player-joined', {
        player: room.players.find(p => p.id === playerId),
        roomState: this.getRoomState(room)
      })
    }

    return room
  }

  /**
   * Join as spectator
   */
  static async joinAsSpectator(
    roomId: string,
    spectatorId: string,
    socketId: string
  ): Promise<GameRoom> {
    const room = this.rooms.get(roomId)
    if (!room) {
      throw new Error('Room not found')
    }

    if (!room.settings.spectatorMode) {
      throw new Error('Spectator mode disabled')
    }

    if (room.spectators.length >= room.settings.maxSpectators) {
      throw new Error('Spectator limit reached')
    }

    if (!room.spectators.includes(spectatorId)) {
      room.spectators.push(spectatorId)
    }

    room.lastActivity = new Date()

    // Notify about new spectator
    if (this.io) {
      this.io.to(roomId).emit('spectator-joined', {
        spectatorId,
        spectatorCount: room.spectators.length
      })
    }

    return room
  }

  /**
   * Mark player as ready
   */
  static setPlayerReady(roomId: string, playerId: string, isReady: boolean): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    const player = room.players.find(p => p.id === playerId)
    if (player) {
      player.isReady = isReady
      room.lastActivity = new Date()

      // Check if all players are ready
      if (room.players.length >= 2 && room.players.every(p => p.isReady)) {
        this.startGame(roomId)
      }

      // Notify room
      if (this.io) {
        this.io.to(roomId).emit('player-ready-changed', {
          playerId,
          isReady,
          allReady: room.players.every(p => p.isReady)
        })
      }
    }
  }

  /**
   * Start the game
   */
  static async startGame(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room || room.status !== 'WAITING') return

    room.status = 'STARTING'
    room.startedAt = new Date()
    room.gameState.timeRemaining = room.settings.timeLimit

    // Start game timer
    this.startGameTimer(roomId)

    // Update match status in database
    await prisma.match.update({
      where: { id: room.matchId },
      data: {
        status: 'ONGOING',
        startedAt: new Date()
      }
    })

    room.status = 'IN_PROGRESS'

    // Notify all clients
    if (this.io) {
      this.io.to(roomId).emit('game-started', {
        roomState: this.getRoomState(room),
        countdown: 3 // 3 second countdown
      })
    }

    // Track game start
    // GameAnalyticsService.trackGameEvent(room.matchId, 'game_started', {
    //   players: room.players.length,
    //   spectators: room.spectators.length,
    //   gameMode: room.gameState.gameMode,
    //   difficulty: room.gameState.difficulty
    // })
  }

  /**
   * Handle player move
   */
  static async makeMove(
    roomId: string,
    playerId: string,
    row: number,
    col: number,
    value: number | null
  ): Promise<GameMove> {
    const room = this.rooms.get(roomId)
    if (!room || room.status !== 'IN_PROGRESS') {
      throw new Error('Game not in progress')
    }

    const player = room.players.find(p => p.id === playerId)
    if (!player) {
      throw new Error('Player not in room')
    }

    // Validate move
    const isValid = value === null || isValidMove(player.progress, row, col, value)

    const move: GameMove = {
      playerId,
      row,
      col,
      value,
      timestamp: new Date(),
      isValid
    }

    if (isValid) {
      // Apply move to player's progress
      player.progress[row][col] = value || 0
      player.moves++
      player.lastMoveAt = new Date()

      // Update score based on difficulty and timing
      if (value !== null) {
        const timeBonus = Math.max(0, room.gameState.timeRemaining! - 1500) / 10
        player.score += 10 + timeBonus
      }

      // Check if player completed the puzzle
      if (isComplete(player.progress)) {
        await this.handlePlayerCompletion(roomId, playerId)
      }
    }

    room.lastActivity = new Date()

    // Broadcast move to all clients
    if (this.io) {
      this.io.to(roomId).emit('move-made', {
        move,
        playerProgress: player.progress,
        playerStats: {
          moves: player.moves,
          score: player.score,
          hintsUsed: player.hintsUsed
        }
      })
    }

    // Track move for analytics
    // GameAnalyticsService.trackGameEvent(room.matchId, 'move_made', {
    //   playerId,
    //   isValid,
    //   moveNumber: player.moves,
    //   timeRemaining: room.gameState.timeRemaining
    // })

    return move
  }

  /**
   * Handle player completion
   */
  static async handlePlayerCompletion(roomId: string, playerId: string): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room) return

    const player = room.players.find(p => p.id === playerId)
    if (!player) return

    // Calculate final score
    const timeBonus = Math.max(0, room.gameState.timeRemaining! * 2)
    const movesPenalty = Math.max(0, (player.moves - 81) * 5)
    const hintsPenalty = player.hintsUsed * 50
    const finalScore = player.score + timeBonus - movesPenalty - hintsPenalty

    player.score = finalScore
    room.status = 'COMPLETED'
    room.endedAt = new Date()

    // Update match in database
    await prisma.match.update({
      where: { id: room.matchId },
      data: {
        status: 'FINISHED',
        winnerId: playerId,
        endedAt: new Date()
      }
    })

    // Update player skill rating
    // await SkillBasedMatchmaking.updatePlayerRating(playerId, true, {
    //   completionTime: (room.endedAt.getTime() - room.startedAt!.getTime()) / 1000,
    //   moves: player.moves,
    //   hintsUsed: player.hintsUsed,
    //   difficulty: room.gameState.difficulty
    // })

    // Update opponent's rating
    const opponent = room.players.find(p => p.id !== playerId)
    if (opponent) {
      // await SkillBasedMatchmaking.updatePlayerRating(opponent.id, false, {
      //   completionTime: (room.endedAt.getTime() - room.startedAt!.getTime()) / 1000,
      //   moves: opponent.moves,
      //   hintsUsed: opponent.hintsUsed,
      //   difficulty: room.gameState.difficulty
      // })
    }

    // Notify all clients
    if (this.io) {
      this.io.to(roomId).emit('game-completed', {
        winner: {
          id: playerId,
          name: player.name,
          score: finalScore,
          stats: {
            moves: player.moves,
            hintsUsed: player.hintsUsed,
            timeSpent: player.timeSpent
          }
        },
        roomState: this.getRoomState(room)
      })
    }

    // Track completion
    // GameAnalytics.trackGameEvent(room.matchId, 'game_completed', {
    //   winnerId: playerId,
    //   finalScore,
    //   totalTime: (room.endedAt.getTime() - room.startedAt!.getTime()) / 1000,
    //   moves: player.moves,
    //   hintsUsed: player.hintsUsed
    // })

    // Clean up room after delay
    setTimeout(() => {
      this.rooms.delete(roomId)
    }, 300000) // 5 minutes
  }

  /**
   * Use hint
   */
  static useHint(roomId: string, playerId: string): { row: number; col: number; value: number } | null {
    const room = this.rooms.get(roomId)
    if (!room || room.status !== 'IN_PROGRESS') return null

    const player = room.players.find(p => p.id === playerId)
    if (!player || player.hintsUsed >= room.settings.hintsAllowed) return null

    // Find an empty cell and provide the correct value
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (player.progress[row][col] === 0) {
          const correctValue = room.gameState.solution[row][col]
          if (correctValue) {
            player.hintsUsed++
            player.score = Math.max(0, player.score - 25) // Penalty for hint

            // Notify room
            if (this.io) {
              this.io.to(roomId).emit('hint-used', {
                playerId,
                hintsRemaining: room.settings.hintsAllowed - player.hintsUsed,
                hintCell: { row, col, value: correctValue }
              })
            }

            return { row, col, value: correctValue }
          }
        }
      }
    }

    return null
  }

  /**
   * Leave room
   */
  static leaveRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    const playerIndex = room.players.findIndex(p => p.id === playerId)
    if (playerIndex !== -1) {
      room.players[playerIndex].isConnected = false

      // If game is in progress, mark as abandoned after timeout
      if (room.status === 'IN_PROGRESS') {
        setTimeout(() => {
          const currentRoom = this.rooms.get(roomId)
          if (currentRoom && !currentRoom.players[playerIndex].isConnected) {
            this.handlePlayerDisconnection(roomId, playerId)
          }
        }, 30000) // 30 seconds to reconnect
      }
    }

    // Remove from spectators
    const spectatorIndex = room.spectators.indexOf(playerId)
    if (spectatorIndex !== -1) {
      room.spectators.splice(spectatorIndex, 1)
    }

    // Notify room
    if (this.io) {
      this.io.to(roomId).emit('player-left', {
        playerId,
        roomState: this.getRoomState(room)
      })
    }
  }

  /**
   * Handle player disconnection
   */
  static async handlePlayerDisconnection(roomId: string, playerId: string): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room) return

    if (room.status === 'IN_PROGRESS') {
      // Award win to remaining connected player
      const remainingPlayer = room.players.find(p => p.id !== playerId && p.isConnected)
      if (remainingPlayer) {
        await this.handlePlayerCompletion(roomId, remainingPlayer.id)
      } else {
        // Both players disconnected - mark as abandoned
        room.status = 'CANCELLED'
        room.endedAt = new Date()

        await prisma.match.update({
          where: { id: room.matchId },
          data: {
            status: 'CANCELLED',
            endedAt: new Date()
          }
        })
      }
    }
  }

  /**
   * Start game timer
   */
  private static startGameTimer(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    const timer = setInterval(() => {
      const currentRoom = this.rooms.get(roomId)
      if (!currentRoom || currentRoom.status !== 'IN_PROGRESS') {
        clearInterval(timer)
        return
      }

      if (currentRoom.gameState.timeRemaining! <= 0) {
        clearInterval(timer)
        this.handleTimeUp(roomId)
        return
      }

      currentRoom.gameState.timeRemaining!--
      currentRoom.lastActivity = new Date()

      // Update player time spent
      currentRoom.players.forEach(player => {
        if (player.isConnected) {
          player.timeSpent++
        }
      })

      // Broadcast time update every 10 seconds
      if (currentRoom.gameState.timeRemaining! % 10 === 0 && this.io) {
        this.io.to(roomId).emit('time-update', {
          timeRemaining: currentRoom.gameState.timeRemaining
        })
      }
    }, 1000)
  }

  /**
   * Handle time up
   */
  static async handleTimeUp(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room) return

    room.status = 'COMPLETED'
    room.endedAt = new Date()

    // Determine winner based on progress/score
    const winner = room.players.reduce((prev, current) => 
      current.score > prev.score ? current : prev
    )

    await prisma.match.update({
      where: { id: room.matchId },
      data: {
        status: 'FINISHED',
        winnerId: winner.id,
        endedAt: new Date()
      }
    })

    // Notify all clients
    if (this.io) {
      this.io.to(roomId).emit('time-up', {
        winner: {
          id: winner.id,
          name: winner.name,
          score: winner.score
        },
        roomState: this.getRoomState(room)
      })
    }

    // Track timeout
    // GameAnalytics.trackGameEvent(room.matchId, 'game_timeout', {
    //   winnerId: winner.id,
    //   finalScores: room.players.map(p => ({ id: p.id, score: p.score }))
    // })
  }

  /**
   * Get room state for clients
   */
  static getRoomState(room: GameRoom) {
    return {
      id: room.id,
      status: room.status,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        isReady: p.isReady,
        isConnected: p.isConnected,
        score: p.score,
        moves: p.moves,
        hintsUsed: p.hintsUsed,
        hintsRemaining: room.settings.hintsAllowed - p.hintsUsed
      })),
      spectatorCount: room.spectators.length,
      gameState: {
        grid: room.gameState.puzzle, // Include the puzzle grid for syncing
        solution: room.gameState.solution, // Include solution for hints
        timeRemaining: room.gameState.timeRemaining,
        gameMode: room.gameState.gameMode,
        difficulty: room.gameState.difficulty
      },
      settings: room.settings
    }
  }

  /**
   * Get room by ID
   */
  static getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId)
  }

  /**
   * Get all active rooms
   */
  static getActiveRooms(): GameRoom[] {
    return Array.from(this.rooms.values()).filter(room => 
      room.status === 'WAITING' || room.status === 'IN_PROGRESS'
    )
  }

  /**
   * Clean up inactive rooms
   */
  static cleanupInactiveRooms(): void {
    const now = new Date()
    const inactiveThreshold = 30 * 60 * 1000 // 30 minutes

    for (const [roomId, room] of this.rooms.entries()) {
      if (now.getTime() - room.lastActivity.getTime() > inactiveThreshold) {
        this.rooms.delete(roomId)
      }
    }
  }
}

// Periodic cleanup
setInterval(() => {
  GameRoomManager.cleanupInactiveRooms()
}, 5 * 60 * 1000) // Every 5 minutes
