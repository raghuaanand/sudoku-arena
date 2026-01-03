import { NextRequest } from 'next/server'
import { Server as SocketIOServer } from 'socket.io'
import { GameRoomManager } from '@/lib/gameRoomManager'

// Global socket server instance for Vercel
let io: SocketIOServer | null = null

export async function GET(request: NextRequest) {
  if (!io) {
    console.log('Initializing Socket.IO server...')
    
    const httpServer = (global as any).httpServer
    
    if (!httpServer) {
      return new Response(
        JSON.stringify({ error: 'HTTP server not available' }),
        { status: 500 }
      )
    }

    io = new SocketIOServer(httpServer, {
      path: '/api/socket/io',
      cors: {
        origin: process.env.NEXTAUTH_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    })

    // Set up GameRoomManager
    GameRoomManager.setSocketServer(io)

    // Socket connection handling
    io.on('connection', (socket) => {
      console.log('User connected:', socket.id)

      socket.on('join-game', async (data) => {
        try {
          const { matchId, userId } = data
          
          await socket.join(`room_${matchId}`)
          
          const room = await GameRoomManager.joinRoom(
            `room_${matchId}`,
            userId,
            data.playerName || 'Player',
            socket.id
          )

          socket.emit('game-state', GameRoomManager.getRoomState(room))
        } catch (error) {
          console.error('Error joining game:', error)
          socket.emit('error', { message: (error as Error).message })
        }
      })

      socket.on('make-move', async (data) => {
        try {
          const { row, col, value, matchId, userId } = data
          
          const move = await GameRoomManager.makeMove(
            `room_${matchId}`,
            userId,
            row,
            col,
            value
          )

          console.log(`Move made by ${userId}:`, move)
        } catch (error) {
          console.error('Error making move:', error)
          socket.emit('move-invalid', { 
            reason: (error as Error).message,
            move: { row: data.row, col: data.col, value: data.value }
          })
        }
      })

      socket.on('request-hint', (data) => {
        try {
          const { matchId, userId } = data
          
          const hint = GameRoomManager.useHint(`room_${matchId}`, userId)
          
          if (hint) {
            socket.emit('hint-provided', hint)
          } else {
            socket.emit('error', { message: 'No hints available' })
          }
        } catch (error) {
          console.error('Error providing hint:', error)
          socket.emit('error', { message: 'Failed to provide hint' })
        }
      })

      socket.on('set-ready', (data) => {
        try {
          const { matchId, userId, isReady } = data
          
          GameRoomManager.setPlayerReady(`room_${matchId}`, userId, isReady)
        } catch (error) {
          console.error('Error setting ready status:', error)
          socket.emit('error', { message: 'Failed to set ready status' })
        }
      })

      socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id)
      })
    })

    console.log('Socket.IO server initialized')
  }

  return new Response(
    JSON.stringify({ 
      status: 'Socket.IO server ready',
      path: '/api/socket/io'
    }),
    { status: 200 }
  )
}

export async function POST() {
  return new Response(
    JSON.stringify({ 
      status: 'Socket.IO endpoint active',
      message: 'Use WebSocket connection for real-time communication'
    }),
    { status: 200 }
  )
}
