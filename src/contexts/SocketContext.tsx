'use client'

import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { type Socket } from 'socket.io-client'
import { createSocketConnection, ensureSocketCompatibility } from '@/lib/socketClient'

interface GameState {
  matchId: string
  gameState: number[][]
  players: string[]
  currentPlayer: number
  isActive: boolean
}

interface RoomState {
  id: string
  status: 'WAITING' | 'STARTING' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'ABANDONED'
  players: Array<{
    id: string
    name: string
    isReady: boolean
    isConnected: boolean
    score: number
    moves: number
    hintsUsed: number
    hintsRemaining: number
  }>
  spectatorCount: number
  gameState: {
    grid?: number[][]
    solution?: number[][]
    timeRemaining?: number
    gameMode: 'SIMULTANEOUS' | 'TURN_BASED' | 'SPEED_BATTLE' | 'SINGLE_PLAYER'
    difficulty: 'easy' | 'medium' | 'hard'
    startTime?: Date
  }
  settings: {
    timeLimit: number
    hintsAllowed: number
    spectatorMode: boolean
    privateRoom: boolean
    maxSpectators: number
  }
}

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
  joinGame: (matchId: string) => void
  makeMove: (row: number, col: number, value: number | null, gameStats?: {
    timeElapsed: number
    movesCount: number
    hintsUsed: number
    errorsCount: number
  }) => void
  requestHint: () => void
  setReady: (isReady: boolean) => void
  sendMessage: (message: string) => void
  surrender: () => void
  leaveGame: () => void
  gameState: GameState | null
  roomState: RoomState | null
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
  joinGame: () => {},
  makeMove: () => {},
  requestHint: () => {},
  setReady: () => {},
  sendMessage: () => {},
  surrender: () => {},
  leaveGame: () => {},
  gameState: null,
  roomState: null,
})

export const useSocket = () => {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider')
  }
  return context
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const currentMatchIdRef = useRef<string>('')
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const { data: session } = useSession()

  useEffect(() => {
    // Ensure socket compatibility
    ensureSocketCompatibility()
    
    console.log('Initializing socket connection...')
    const socketInstance = createSocketConnection()

    socketInstance.on('connect', () => {
      console.log('Connected to Socket.IO server')
      setIsConnected(true)
    })

    socketInstance.on('disconnect', () => {
      console.log('Disconnected from Socket.IO server')
      setIsConnected(false)
    })

    // Enhanced game state handling
    socketInstance.on('game-state', (data: RoomState) => {
      console.log('Game state updated:', data)
      setRoomState(data)
      
      // Convert room state to legacy game state for compatibility
      setGameState({
        matchId: currentMatchIdRef.current,
        gameState: [], // Will be filled from actual game data
        players: data.players.map(p => p.id),
        currentPlayer: 0, // Will be determined by game logic
        isActive: data.status === 'IN_PROGRESS'
      })
    })

    socketInstance.on('player-joined', (data: { userId: string; playerName: string; roomState: RoomState }) => {
      console.log('Player joined:', data)
      setRoomState(data.roomState)
    })

    socketInstance.on('spectator-joined', (data: { userId: string; spectatorCount: number }) => {
      console.log('Spectator joined:', data)
    })

    socketInstance.on('move-made', (data: { 
      move: { 
        playerId: string; 
        row: number; 
        col: number; 
        value: number | null; 
        timestamp: Date; 
        isValid: boolean 
      }; 
      playerProgress: number[][]; 
      playerStats: { 
        moves: number; 
        score: number; 
        hintsUsed: number 
      } 
    }) => {
      console.log('Move made:', data)
      // Move data will be handled by the GameRoomManager through game-state updates
    })

    socketInstance.on('move-invalid', (data: { 
      reason: string; 
      move: { 
        row: number; 
        col: number; 
        value: number | null 
      } 
    }) => {
      console.log('Invalid move:', data)
      // Handle invalid move feedback
    })

    socketInstance.on('hint-provided', (data: { row: number; col: number; value: number }) => {
      console.log('Hint provided:', data)
      // Handle hint
    })

    socketInstance.on('hint-used', (data: { 
      playerId: string; 
      hintsRemaining: number; 
      hintCell: { row: number; col: number; value: number } 
    }) => {
      console.log('Hint used:', data)
      // Update room state with new hints remaining
    })

    socketInstance.on('player-ready-changed', (data: { playerId: string; isReady: boolean; allReady: boolean }) => {
      console.log('Player ready status changed:', data)
      // Update room state
    })

    socketInstance.on('game-started', (data: { roomState: RoomState; countdown: number }) => {
      console.log('Game started:', data)
      setRoomState(data.roomState)
    })

    socketInstance.on('game-completed', (data: { 
      winner: { 
        id: string; 
        name: string; 
        score: number; 
        stats: { 
          moves: number; 
          hintsUsed: number; 
          timeSpent: number 
        } 
      }; 
      roomState: RoomState 
    }) => {
      console.log('Game completed:', data)
      setRoomState(data.roomState)
    })

    socketInstance.on('time-update', (data: { timeRemaining: number }) => {
      console.log('Time update:', data)
      // Update time remaining in room state
      setRoomState(prev => prev ? {
        ...prev,
        gameState: {
          ...prev.gameState,
          timeRemaining: data.timeRemaining
        }
      } : null)
    })

    socketInstance.on('time-up', (data: { 
      winner: { 
        id: string; 
        name: string; 
        score: number 
      }; 
      roomState: RoomState 
    }) => {
      console.log('Time up:', data)
      setRoomState(data.roomState)
    })

    socketInstance.on('player-left', (data: { playerId: string; roomState: RoomState }) => {
      console.log('Player left:', data)
      setRoomState(data.roomState)
    })

    socketInstance.on('player-disconnected', (data: { userId: string; timestamp: string }) => {
      console.log('Player disconnected:', data)
    })

    socketInstance.on('player-surrendered', (data: { playerId: string; timestamp: string }) => {
      console.log('Player surrendered:', data)
    })

    socketInstance.on('message-received', (data: { playerId: string; playerName: string; message: string; timestamp: string }) => {
      console.log('Message received:', data)
      // Handle chat messages
    })

    socketInstance.on('error', (data: { message: string }) => {
      console.error('Socket error:', data.message)
    })

    setSocket(socketInstance)

    return () => {
      socketInstance.disconnect()
    }
  }, []) // Remove currentMatchId dependency

  const joinGame = (matchId: string) => {
    if (socket && session?.user?.id) {
      currentMatchIdRef.current = matchId
      socket.emit('join-game', { matchId, userId: session.user.id })
    }
  }

  const makeMove = (row: number, col: number, value: number | null, gameStats?: {
    timeElapsed: number
    movesCount: number
    hintsUsed: number
    errorsCount: number
  }) => {
    if (socket && session?.user?.id && currentMatchIdRef.current) {
      socket.emit('make-move', { 
        matchId: currentMatchIdRef.current,
        userId: session.user.id,
        row, 
        col, 
        value 
      })
      
      // Also persist to API for game state tracking
      if (gameStats) {
        fetch(`/api/matches/${currentMatchIdRef.current}/move`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            row,
            col,
            value,
            grid: gameState?.gameState || [],
            timeElapsed: gameStats.timeElapsed,
            movesCount: gameStats.movesCount,
            hintsUsed: gameStats.hintsUsed,
            errorsCount: gameStats.errorsCount
          })
        }).catch(error => {
          console.error('Error persisting move:', error)
        })
      }
    }
  }

  const requestHint = () => {
    if (socket && session?.user?.id && currentMatchIdRef.current) {
      socket.emit('request-hint', {
        matchId: currentMatchIdRef.current,
        userId: session.user.id
      })
    }
  }

  const setReady = (isReady: boolean) => {
    if (socket && session?.user?.id && currentMatchIdRef.current) {
      socket.emit('set-ready', { 
        matchId: currentMatchIdRef.current,
        userId: session.user.id,
        isReady 
      })
    }
  }

  const sendMessage = (message: string) => {
    if (socket) {
      socket.emit('send-message', { message })
    }
  }

  const surrender = () => {
    if (socket) {
      socket.emit('surrender')
    }
  }

  const leaveGame = () => {
    if (socket && currentMatchIdRef.current) {
      // The GameRoomManager will handle the leave through disconnect
      currentMatchIdRef.current = ''
      setGameState(null)
      setRoomState(null)
    }
  }

  return (
    <SocketContext.Provider value={{
      socket,
      isConnected,
      joinGame,
      makeMove,
      requestHint,
      setReady,
      sendMessage,
      surrender,
      leaveGame,
      gameState,
      roomState
    }}>
      {children}
    </SocketContext.Provider>
  )
}
