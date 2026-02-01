/**
 * Standalone Socket.IO Server
 * 
 * Run this alongside `npm run dev` for local development with WebSocket support.
 * Usage: node socket-server.js
 */

const { createServer } = require('http')
const { Server } = require('socket.io')

const socketPort = process.env.SOCKET_PORT || 3003
const nextPort = process.env.PORT || 3000
const dev = process.env.NODE_ENV !== 'production'

// In-memory storage for game states
const gameStates = new Map()
const playerSockets = new Map() // oderId -> socketId
const socketPlayers = new Map() // socketId -> { oderId, matchId }

// Create HTTP server for Socket.IO
const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 
      status: 'ok', 
      connections: io.engine.clientsCount,
      games: gameStates.size
    }))
    return
  }
  res.writeHead(404)
  res.end()
})

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: dev 
      ? [`http://localhost:${nextPort}`, 'http://127.0.0.1:' + nextPort]
      : process.env.NEXTAUTH_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
})

console.log('Starting Socket.IO server...')

// ============================================
// Socket.IO Event Handlers
// ============================================

io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`)

  // ----------------------------------------
  // Join Game Room
  // ----------------------------------------
  socket.on('join-game', async (data) => {
    try {
      const { matchId, userId, playerName, matchType } = data
      
      if (!matchId || !userId) {
        socket.emit('error', { code: 'INVALID_DATA', message: 'matchId and userId are required' })
        return
      }

      console.log(`[JOIN] User ${userId} joining match ${matchId} (type: ${matchType || 'unknown'})`)

      // Track player
      playerSockets.set(userId, socket.id)
      socketPlayers.set(socket.id, { userId, matchId })

      // Join Socket.IO room
      socket.join(`match:${matchId}`)

      // Determine if single player based on matchType
      const isSinglePlayer = matchType === 'SINGLE_PLAYER'

      // Initialize game state if not exists
      if (!gameStates.has(matchId)) {
        gameStates.set(matchId, {
          matchId,
          players: new Map(),
          status: isSinglePlayer ? 'ONGOING' : 'WAITING',
          startTime: isSinglePlayer ? Date.now() : null,
          isSinglePlayer
        })
      }

      const gameState = gameStates.get(matchId)
      
      // Add player to game
      gameState.players.set(userId, {
        oderId: userId, // Keep for compatibility
        userId,
        playerName: playerName || 'Player',
        socketId: socket.id,
        score: 0,
        connected: true,
        lastMoveAt: null
      })

      // Notify room
      io.to(`match:${matchId}`).emit('player-joined', {
        userId,
        playerName: playerName || 'Player',
        playerCount: gameState.players.size
      })

      // Send current game state to joining player
      socket.emit('game-state', {
        matchId,
        playerCount: gameState.players.size,
        status: gameState.status,
        isSinglePlayer: gameState.isSinglePlayer,
        players: Array.from(gameState.players.values()).map(p => ({
          oderId: p.oderId || p.userId,
          userId: p.userId,
          playerName: p.playerName,
          score: p.score,
          connected: p.connected
        }))
      })

      // For single player, game starts immediately
      if (gameState.isSinglePlayer) {
        io.to(`match:${matchId}`).emit('game-start', {
          startTime: gameState.startTime,
          timeLimit: 1800, // 30 minutes for single player
          isSinglePlayer: true
        })
      }
      // Check if multiplayer game can start (2 players)
      else if (gameState.players.size === 2 && gameState.status === 'WAITING') {
        gameState.status = 'READY'
        io.to(`match:${matchId}`).emit('game-ready', {
          message: 'Both players connected. Game starting...'
        })
      }

    } catch (error) {
      console.error('[JOIN ERROR]', error)
      socket.emit('error', { code: 'JOIN_ERROR', message: error.message })
    }
  })

  // ----------------------------------------
  // Player Ready
  // ----------------------------------------
  socket.on('player-ready', (data) => {
    const playerData = socketPlayers.get(socket.id)
    if (!playerData) return

    const { matchId, userId } = playerData
    const gameState = gameStates.get(matchId)
    if (!gameState) return

    const player = gameState.players.get(userId)
    if (player) {
      player.ready = true
    }

    // Check if all players ready
    const allReady = Array.from(gameState.players.values()).every(p => p.ready)
    if (allReady && gameState.status === 'READY') {
      gameState.status = 'ONGOING'
      gameState.startTime = Date.now()
      
      io.to(`match:${matchId}`).emit('game-start', {
        startTime: gameState.startTime,
        timeLimit: 600 // 10 minutes
      })
    }
  })

  // ----------------------------------------
  // Game Move
  // ----------------------------------------
  socket.on('game-move', (data) => {
    const playerData = socketPlayers.get(socket.id)
    if (!playerData) return

    const { matchId, userId } = playerData
    const { row, col, value, isCorrect, score } = data

    const gameState = gameStates.get(matchId)
    if (!gameState) return

    const player = gameState.players.get(userId)
    if (player) {
      player.score = score
      player.lastMoveAt = Date.now()
    }

    // Broadcast move to other players
    socket.to(`match:${matchId}`).emit('opponent-move', {
      userId,
      row,
      col,
      isCorrect,
      score
    })
  })

  // ----------------------------------------
  // Score Update
  // ----------------------------------------
  socket.on('score-update', (data) => {
    const playerData = socketPlayers.get(socket.id)
    if (!playerData) return

    const { matchId, userId } = playerData
    const { score } = data

    const gameState = gameStates.get(matchId)
    if (!gameState) return

    const player = gameState.players.get(userId)
    if (player) {
      player.score = score
    }

    // Broadcast scores to all in room
    io.to(`match:${matchId}`).emit('scores-updated', {
      scores: Object.fromEntries(
        Array.from(gameState.players.entries()).map(([id, p]) => [id, p.score])
      )
    })
  })

  // ----------------------------------------
  // Game Complete
  // ----------------------------------------
  socket.on('game-complete', (data) => {
    const playerData = socketPlayers.get(socket.id)
    if (!playerData) return

    const { matchId, userId } = playerData
    const { finalScore, completedAt } = data

    const gameState = gameStates.get(matchId)
    if (!gameState) return

    const player = gameState.players.get(userId)
    if (player) {
      player.score = finalScore
      player.completedAt = completedAt
    }

    // Check if all players completed or determine winner
    const players = Array.from(gameState.players.values())
    const allCompleted = players.every(p => p.completedAt)

    if (allCompleted || gameState.status === 'FINISHING') {
      gameState.status = 'FINISHED'
      
      // Determine winner (highest score)
      const sorted = players.sort((a, b) => b.score - a.score)
      const winner = sorted[0]

      io.to(`match:${matchId}`).emit('game-end', {
        winner: winner.userId || winner.oderId,
        scores: Object.fromEntries(players.map(p => [p.userId || p.oderId, p.score])),
        reason: 'completed'
      })

      // Clean up after delay
      setTimeout(() => {
        gameStates.delete(matchId)
      }, 60000) // Keep for 1 minute for reconnections
    }
  })

  // ----------------------------------------
  // Chat Message
  // ----------------------------------------
  socket.on('chat-message', (data) => {
    const playerData = socketPlayers.get(socket.id)
    if (!playerData) return

    const { matchId, userId } = playerData
    const { message } = data

    // Broadcast to room
    io.to(`match:${matchId}`).emit('chat-message', {
      userId,
      message,
      timestamp: Date.now()
    })
  })

  // ----------------------------------------
  // Leave Game
  // ----------------------------------------
  socket.on('leave-game', () => {
    handlePlayerLeave(socket)
  })

  // ----------------------------------------
  // Disconnect
  // ----------------------------------------
  socket.on('disconnect', (reason) => {
    console.log(`[${new Date().toISOString()}] Client disconnected: ${socket.id} (${reason})`)
    handlePlayerLeave(socket, true)
  })
})

// ============================================
// Helper Functions
// ============================================

function handlePlayerLeave(socket, isDisconnect = false) {
  const playerData = socketPlayers.get(socket.id)
  if (!playerData) return

  const { matchId, userId } = playerData

  const gameState = gameStates.get(matchId)
  if (gameState) {
    const player = gameState.players.get(userId)
    if (player) {
      if (isDisconnect) {
        // Mark as disconnected but keep in game for potential reconnect
        player.connected = false
        player.disconnectedAt = Date.now()

        // Notify others
        socket.to(`match:${matchId}`).emit('player-disconnected', {
          userId,
          temporary: true
        })

        // Auto-forfeit after 60 seconds of disconnect during game
        if (gameState.status === 'ONGOING') {
          setTimeout(() => {
            const currentPlayer = gameState.players.get(userId)
            if (currentPlayer && !currentPlayer.connected) {
              handleForfeit(matchId, userId)
            }
          }, 60000)
        }
      } else {
        // Explicit leave - remove from game
        gameState.players.delete(userId)
        
        socket.to(`match:${matchId}`).emit('player-left', {
          userId
        })

        // If game was ongoing and player left, other player wins
        if (gameState.status === 'ONGOING' && gameState.players.size === 1 && !gameState.isSinglePlayer) {
          handleForfeit(matchId, userId)
        }
      }
    }
  }

  // Clean up socket tracking
  playerSockets.delete(userId)
  socketPlayers.delete(socket.id)
  socket.leave(`match:${matchId}`)
}

function handleForfeit(matchId, forfeitingUserId) {
  const gameState = gameStates.get(matchId)
  if (!gameState || gameState.status === 'FINISHED') return

  gameState.status = 'FINISHED'

  // Find winner (the other player)
  const players = Array.from(gameState.players.values())
  const winner = players.find(p => (p.userId || p.oderId) !== forfeitingUserId)

  io.to(`match:${matchId}`).emit('game-end', {
    winner: winner?.userId || winner?.oderId || null,
    scores: Object.fromEntries(players.map(p => [p.userId || p.oderId, p.score])),
    reason: 'forfeit',
    forfeitedBy: forfeitingUserId
  })
}

// ============================================
// Start Server
// ============================================

httpServer.listen(socketPort, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎮 Sudoku Arena Socket.IO Server                       ║
║                                                           ║
║   WebSocket:  ws://localhost:${socketPort}                      ║
║   Health:     http://localhost:${socketPort}/health              ║
║                                                           ║
║   Run 'npm run dev' in another terminal for Next.js      ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down Socket.IO server...')
  io.close(() => {
    console.log('Socket.IO server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('Shutting down Socket.IO server...')
  io.close(() => {
    console.log('Socket.IO server closed')
    process.exit(0)
  })
})
