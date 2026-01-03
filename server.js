const { createServer } = require('http')
const { Server } = require('socket.io')
const next = require('next')

// Since GameRoomManager is TypeScript, we'll handle it dynamically
let GameRoomManager = null

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = process.env.PORT || 3000
const socketPort = process.env.SOCKET_PORT || 3003

// In-memory storage for room states (fallback when GameRoomManager is not available)
const roomStates = new Map()

// Create Next.js app
const app = next({ dev, hostname, port })
const handler = app.getRequestHandler()

app.prepare().then(async () => {
  // Dynamically import GameRoomManager since it's TypeScript
  try {
    const gameRoomModule = await import('./src/lib/gameRoomManager.ts')
    GameRoomManager = gameRoomModule.GameRoomManager
    console.log('GameRoomManager loaded successfully')
  } catch (error) {
    console.warn('GameRoomManager not available:', error.message)
    console.log('Running in basic mode without advanced game room features')
  }
  // Create HTTP server for Next.js
  const httpServer = createServer(handler)

  // Create separate HTTP server for Socket.IO
  const socketServer = createServer()
  
  // Initialize Socket.IO
  const io = new Server(socketServer, {
    cors: {
      origin: dev ? `http://localhost:${port}` : process.env.NEXTAUTH_URL || `http://localhost:${port}`,
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  })

  // Set up GameRoomManager with Socket.IO
  if (GameRoomManager) {
    GameRoomManager.setSocketServer(io)
  }

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id)

    // Join game room
    socket.on('join-game', async (data) => {
      try {
        const { matchId, userId } = data
        console.log(`User ${userId} joining match ${matchId}`)

        // Store matchId and userId in socket data for subsequent handlers
        socket.data.matchId = matchId
        socket.data.userId = userId
        socket.data.playerName = data.playerName || 'Player'

        // Join socket room
        await socket.join(`room_${matchId}`)

        if (GameRoomManager) {
          // Join game room through GameRoomManager
          const room = await GameRoomManager.joinRoom(
            `room_${matchId}`,
            userId,
            data.playerName || 'Player',
            socket.id
          )

          // Emit room state to user
          socket.emit('game-state', GameRoomManager.getRoomState(room))
        } else {
          // Basic fallback - fetch match data from database
          try {
            const { PrismaClient } = require('@prisma/client')
            const prisma = new PrismaClient()

            const match = await prisma.match.findUnique({
              where: { id: matchId },
              include: {
                player1: true,
                player2: true
              }
            })

            if (match) {
              const grid = match.sudokuGrid ? JSON.parse(match.sudokuGrid) : Array(9).fill(null).map(() => Array(9).fill(0))

              socket.emit('game-state', {
                id: `room_${matchId}`,
                status: match.status,
                players: [
                  {
                    id: match.player1Id,
                    name: match.player1.name || 'Player 1',
                    isReady: false,
                    isConnected: true,
                    score: 0,
                    moves: 0,
                    hintsUsed: 0,
                    hintsRemaining: 3
                  },
                  ...(match.player2Id ? [{
                    id: match.player2Id,
                    name: match.player2?.name || 'Player 2',
                    isReady: false,
                    isConnected: true,
                    score: 0,
                    moves: 0,
                    hintsUsed: 0,
                    hintsRemaining: 3
                  }] : [])
                ],
                spectatorCount: 0,
                gameState: {
                  grid: grid,
                  solution: match.solution ? JSON.parse(match.solution) : null,
                  timeRemaining: 1800,
                  gameMode: match.gameMode || 'SIMULTANEOUS',
                  difficulty: match.difficulty || 'medium'
                },
                settings: {
                  timeLimit: 1800,
                  hintsAllowed: 3,
                  spectatorMode: false,
                  privateRoom: false,
                  maxSpectators: 10
                }
              })
            } else {
              socket.emit('error', { message: 'Match not found' })
            }

            await prisma.$disconnect()
          } catch (dbError) {
            console.error('Database error:', dbError)
            socket.emit('error', { message: 'Failed to load match data' })
          }
        }

        console.log(`User ${userId} successfully joined room_${matchId}`)
      } catch (error) {
        console.error('Error joining game:', error)
        socket.emit('error', { message: error.message })
      }
    })

    // Handle player moves
    socket.on('make-move', async (data) => {
      try {
        const { row, col, value } = data
        const socketData = socket.data

        if (!socketData.matchId || !socketData.userId) {
          socket.emit('error', { message: 'Not in a game room' })
          return
        }

        if (GameRoomManager) {
          const move = await GameRoomManager.makeMove(
            `room_${socketData.matchId}`,
            socketData.userId,
            row,
            col,
            value
          )
          console.log(`Move made by ${socketData.userId}:`, move)
        } else {
          // Basic fallback - update database and broadcast
          const { PrismaClient } = require('@prisma/client')
          const prisma = new PrismaClient()

          try {
            const match = await prisma.match.findUnique({
              where: { id: socketData.matchId },
              include: {
                player1: true,
                player2: true
              }
            })

            if (match && match.status === 'IN_PROGRESS') {
              // Parse current grid
              let grid = match.sudokuGrid ? JSON.parse(match.sudokuGrid) : Array(9).fill(null).map(() => Array(9).fill(0))

              // Update the grid
              grid[row][col] = value

              // Save to database
              await prisma.match.update({
                where: { id: socketData.matchId },
                data: {
                  sudokuGrid: JSON.stringify(grid),
                  updatedAt: new Date()
                }
              })

              // Broadcast move to all players in room
              io.to(`room_${socketData.matchId}`).emit('move-made', {
                userId: socketData.userId,
                playerName: socketData.playerName,
                row,
                col,
                value
              })

              // Emit updated game state
              const gameState = {
                id: `room_${socketData.matchId}`,
                status: match.status,
                players: [
                  {
                    id: match.player1Id,
                    name: match.player1.name || 'Player 1',
                    isReady: true,
                    isConnected: true,
                    score: 0,
                    moves: 0,
                    hintsUsed: 0,
                    hintsRemaining: 3
                  },
                  ...(match.player2Id ? [{
                    id: match.player2Id,
                    name: match.player2?.name || 'Player 2',
                    isReady: true,
                    isConnected: true,
                    score: 0,
                    moves: 0,
                    hintsUsed: 0,
                    hintsRemaining: 3
                  }] : [])
                ],
                spectatorCount: 0,
                gameState: {
                  grid: grid,
                  solution: match.solution ? JSON.parse(match.solution) : null,
                  timeRemaining: 1800,
                  gameMode: match.gameMode || 'SIMULTANEOUS',
                  difficulty: match.difficulty || 'medium'
                },
                settings: {
                  timeLimit: 1800,
                  hintsAllowed: 3,
                  spectatorMode: false,
                  privateRoom: false,
                  maxSpectators: 10
                }
              }

              io.to(`room_${socketData.matchId}`).emit('game-state', gameState)
            }

            await prisma.$disconnect()
          } catch (dbError) {
            console.error('Database error in make-move:', dbError)
            await prisma.$disconnect()
            socket.emit('move-invalid', {
              reason: 'Database error',
              move: { row, col, value }
            })
          }
        }
      } catch (error) {
        console.error('Error making move:', error)
        socket.emit('move-invalid', {
          reason: error.message,
          move: { row: data.row, col: data.col, value: data.value }
        })
      }
    })

    // Handle hint requests
    socket.on('request-hint', () => {
      try {
        const socketData = socket.data
        
        if (!socketData.matchId || !socketData.userId) {
          socket.emit('error', { message: 'Not in a game room' })
          return
        }

        if (GameRoomManager) {
          const hint = GameRoomManager.useHint(`room_${socketData.matchId}`, socketData.userId)
          
          if (hint) {
            socket.emit('hint-provided', hint)
          } else {
            socket.emit('error', { message: 'No hints available' })
          }
        } else {
          socket.emit('error', { message: 'Hints not available in basic mode' })
        }
      } catch (error) {
        console.error('Error providing hint:', error)
        socket.emit('error', { message: 'Failed to provide hint' })
      }
    })

    // Handle ready status
    socket.on('set-ready', async (data) => {
      try {
        const socketData = socket.data

        if (!socketData.matchId || !socketData.userId) {
          socket.emit('error', { message: 'Not in a game room' })
          return
        }

        if (GameRoomManager) {
          GameRoomManager.setPlayerReady(`room_${socketData.matchId}`, socketData.userId, data.isReady)
        } else {
          // Basic fallback - track ready status and start game when all ready
          const roomId = `room_${socketData.matchId}`

          // Initialize room state if not exists
          if (!roomStates.has(roomId)) {
            roomStates.set(roomId, { readyPlayers: new Set() })
          }

          const roomState = roomStates.get(roomId)

          // Update ready status
          if (data.isReady) {
            roomState.readyPlayers.add(socketData.userId)
          } else {
            roomState.readyPlayers.delete(socketData.userId)
          }

          // Broadcast ready status to all players in room
          io.to(roomId).emit('player-ready', {
            userId: socketData.userId,
            playerName: socketData.playerName,
            isReady: data.isReady
          })

          // Check if we should start the game
          const { PrismaClient } = require('@prisma/client')
          const prisma = new PrismaClient()

          try {
            const match = await prisma.match.findUnique({
              where: { id: socketData.matchId },
              include: {
                player1: true,
                player2: true
              }
            })

            if (match) {
              const totalPlayers = match.player2Id ? 2 : 1
              const readyCount = roomState.readyPlayers.size

              console.log(`Room ${roomId}: ${readyCount}/${totalPlayers} players ready`)

              // Start game if all players are ready
              if (readyCount === totalPlayers && readyCount > 0 && match.status === 'WAITING') {
                console.log(`Starting game for match ${socketData.matchId}`)

                // Update match status to IN_PROGRESS
                await prisma.match.update({
                  where: { id: socketData.matchId },
                  data: {
                    status: 'IN_PROGRESS',
                    startedAt: new Date()
                  }
                })

                // Get the updated match with grid
                const updatedMatch = await prisma.match.findUnique({
                  where: { id: socketData.matchId },
                  include: {
                    player1: true,
                    player2: true
                  }
                })

                const grid = updatedMatch.sudokuGrid ? JSON.parse(updatedMatch.sudokuGrid) : Array(9).fill(null).map(() => Array(9).fill(0))

                // Emit game started event with updated state
                const gameState = {
                  id: roomId,
                  status: 'IN_PROGRESS',
                  players: [
                    {
                      id: updatedMatch.player1Id,
                      name: updatedMatch.player1.name || 'Player 1',
                      isReady: true,
                      isConnected: true,
                      score: 0,
                      moves: 0,
                      hintsUsed: 0,
                      hintsRemaining: 3
                    },
                    ...(updatedMatch.player2Id ? [{
                      id: updatedMatch.player2Id,
                      name: updatedMatch.player2?.name || 'Player 2',
                      isReady: true,
                      isConnected: true,
                      score: 0,
                      moves: 0,
                      hintsUsed: 0,
                      hintsRemaining: 3
                    }] : [])
                  ],
                  spectatorCount: 0,
                  gameState: {
                    grid: grid,
                    solution: updatedMatch.solution ? JSON.parse(updatedMatch.solution) : null,
                    timeRemaining: 1800,
                    gameMode: updatedMatch.gameMode || 'SIMULTANEOUS',
                    difficulty: updatedMatch.difficulty || 'medium',
                    startTime: new Date()
                  },
                  settings: {
                    timeLimit: 1800,
                    hintsAllowed: 3,
                    spectatorMode: false,
                    privateRoom: false,
                    maxSpectators: 10
                  }
                }

                io.to(roomId).emit('game-started', { roomState: gameState, countdown: 0 })
                io.to(roomId).emit('game-state', gameState)
              }
            }

            await prisma.$disconnect()
          } catch (dbError) {
            console.error('Database error in set-ready:', dbError)
            await prisma.$disconnect()
          }
        }
      } catch (error) {
        console.error('Error setting ready status:', error)
        socket.emit('error', { message: 'Failed to set ready status' })
      }
    })

    // Handle surrender
    socket.on('surrender', () => {
      try {
        const socketData = socket.data
        
        if (!socketData.matchId || !socketData.userId) {
          return
        }

        // Handle surrender logic through GameRoomManager
        console.log(`Player ${socketData.userId} surrendered in match ${socketData.matchId}`)
        
        // Emit surrender event to room
        socket.to(`room_${socketData.matchId}`).emit('player-surrendered', {
          playerId: socketData.userId,
          timestamp: new Date().toISOString()
        })
      } catch (error) {
        console.error('Error handling surrender:', error)
      }
    })

    // Handle chat messages
    socket.on('send-message', (data) => {
      try {
        const socketData = socket.data

        if (!socketData.matchId || !socketData.userId) {
          return
        }

        // Broadcast message to room (emit to both event names for compatibility)
        const messageData = {
          playerId: socketData.userId,
          playerName: socketData.playerName || 'Player',
          message: data.message,
          timestamp: new Date().toISOString()
        }

        io.to(`room_${socketData.matchId}`).emit('message-received', messageData)
        io.to(`room_${socketData.matchId}`).emit('game-message', messageData)
      } catch (error) {
        console.error('Error sending message:', error)
      }
    })

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id)
      
      const socketData = socket.data
      if (socketData.matchId && socketData.userId) {
        if (GameRoomManager) {
          GameRoomManager.leaveRoom(`room_${socketData.matchId}`, socketData.userId)
        } else {
          // Basic fallback - just broadcast disconnect
          socket.to(`room_${socketData.matchId}`).emit('player-disconnected', {
            userId: socketData.userId
          })
        }
      }
    })
  })

  // Start Next.js server
  httpServer.listen(port, (err) => {
    if (err) throw err
    console.log(`> Next.js ready on http://${hostname}:${port}`)
  })

  // Start Socket.IO server
  socketServer.listen(socketPort, (err) => {
    if (err) throw err
    console.log(`> Socket.IO ready on http://${hostname}:${socketPort}`)
  })
})
