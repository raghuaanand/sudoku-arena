'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useSocket } from '@/contexts/SocketContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SudokuGridComponent } from '@/components/sudoku/SudokuGrid'
import { 
  Users, 
  Trophy, 
  Timer,
  Crown,
  MessageCircle,
  Lightbulb,
  Flag,
  CheckCircle,
  Wifi,
  WifiOff
} from 'lucide-react'

interface GameRoomProps {
  matchId: string
}

export function GameRoom({ matchId }: GameRoomProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const { 
    socket, 
    isConnected, 
    makeMove, 
    leaveGame, 
    gameState,
    roomState,
    requestHint,
    setReady,
    surrender,
    sendMessage
  } = useSocket()
  
  const [messages, setMessages] = useState<string[]>([])
  const [timeLeft, setTimeLeft] = useState<number>(1800) // 30 minutes
  const [chatVisible, setChatVisible] = useState(false)
  const [isPlayerReady, setIsPlayerReady] = useState(false)
  const [showSurrenderConfirm, setShowSurrenderConfirm] = useState(false)
  const [chatMessage, setChatMessage] = useState('')
  const [initialGrid, setInitialGrid] = useState<number[][] | null>(null)

  const addMessage = useCallback((message: string) => {
    setMessages(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`])
  }, [])

  useEffect(() => {
    if (!session?.user?.id) {
      router.push('/auth/signin')
      return
    }

    // Join the game room
    if (socket && isConnected) {
      socket.emit('join-game', {
        matchId,
        userId: session.user.id,
        playerName: session.user.name || session.user.email || 'Player'
      })
    }
  }, [socket, isConnected, matchId, router, session?.user?.id, session?.user?.name, session?.user?.email])

  // Fetch initial match data to get the puzzle
  useEffect(() => {
    const fetchMatchData = async () => {
      try {
        const response = await fetch(`/api/matches/${matchId}`)
        if (response.ok) {
          const matchData = await response.json()
          console.log('Initial match data:', matchData)
          
          if (matchData.match && matchData.match.sudokuGrid) {
            // Parse the sudoku grid from JSON string
            const parsedGrid = JSON.parse(matchData.match.sudokuGrid)
            console.log('Parsed initial grid:', parsedGrid)
            setInitialGrid(parsedGrid)
          }
        }
      } catch (error) {
        console.error('Failed to fetch match data:', error)
      }
    }

    if (matchId && session?.user?.id && !initialGrid) {
      fetchMatchData()
    }
  }, [matchId, session?.user?.id, initialGrid])

  // Handle Socket events for UI updates
  useEffect(() => {
    if (!socket) return

    const handlePlayerJoined = (data: { userId: string; playerName: string }) => {
      addMessage(`${data.playerName} joined the game`)
    }

    const handlePlayerLeft = (data: { userId: string; playerName: string }) => {
      addMessage(`${data.playerName} left the game`)
    }

    const handleMoveMade = (data: { row: number; col: number; value: number; playerName: string }) => {
      addMessage(`${data.playerName} made a move: (${data.row + 1}, ${data.col + 1}) = ${data.value}`)
    }

    const handleGameCompleted = (data: { 
      result?: 'won' | 'lost'
      winner?: { id: string; name: string; score: number }
      message?: string
      reason?: string 
    }) => {
      if (data.result === 'won') {
        addMessage('🎉 ' + (data.message || 'Congratulations! You won!'))
      } else if (data.result === 'lost') {
        addMessage('❌ ' + (data.message || 'Game Over! You lost.'))
      } else if (data.winner) {
        // Legacy format support
        if (data.winner.id === session?.user?.id) {
          addMessage('🎉 Congratulations! You won!')
        } else {
          addMessage(`Game completed. Winner: ${data.winner.name}`)
        }
      }
      
      if (data.reason) {
        addMessage(`Reason: ${data.reason}`)
      }
    }

    const handleHintReceived = (data: { row: number; col: number; value: number }) => {
      addMessage(`💡 Hint: Try ${data.value} at (${data.row + 1}, ${data.col + 1})`)
    }

    const handleGameMessage = (data: { message: string; playerName?: string }) => {
      if (data.playerName) {
        addMessage(`${data.playerName}: ${data.message}`)
      } else {
        addMessage(data.message)
      }
    }

    const handlePlayerReady = (data: { userId: string; isReady: boolean; playerName: string }) => {
      addMessage(`${data.playerName} is ${data.isReady ? 'ready' : 'not ready'}`)
    }

    socket.on('player-joined', handlePlayerJoined)
    socket.on('player-left', handlePlayerLeft)
    socket.on('move-made', handleMoveMade)
    socket.on('game-completed', handleGameCompleted)
    socket.on('hint-received', handleHintReceived)
    socket.on('game-message', handleGameMessage)
    socket.on('player-ready', handlePlayerReady)
    socket.on('game-started', () => addMessage('🎮 Game started!'))
    socket.on('game-paused', () => addMessage('⏸️ Game paused'))
    socket.on('game-resumed', () => addMessage('▶️ Game resumed'))
    socket.on('player-surrendered', (data: { playerName: string }) => {
      addMessage(`🏳️ ${data.playerName} surrendered`)
    })

    return () => {
      socket.off('player-joined', handlePlayerJoined)
      socket.off('player-left', handlePlayerLeft)
      socket.off('move-made', handleMoveMade)
      socket.off('game-completed', handleGameCompleted)
      socket.off('hint-received', handleHintReceived)
      socket.off('game-message', handleGameMessage)
      socket.off('player-ready', handlePlayerReady)
      socket.off('game-started')
      socket.off('game-paused')
      socket.off('game-resumed')
      socket.off('player-surrendered')
    }
  }, [socket, session, addMessage])

  // Timer effect - use roomState time if available
  useEffect(() => {
    const currentTime = roomState?.gameState?.timeRemaining ?? timeLeft
    if (currentTime !== timeLeft) {
      setTimeLeft(currentTime)
    }

    if (roomState?.status !== 'IN_PROGRESS') return

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          addMessage('⏰ Time is up!')
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [roomState?.status, roomState?.gameState?.timeRemaining, addMessage, timeLeft])

  // Helper functions
  const convertToSudokuGrid = (grid: number[][]): (number | null)[][] => {
    return grid.map(row => 
      row.map(cell => cell === 0 ? null : cell)
    )
  }

  const getCurrentGameGrid = (): number[][] => {
    if (roomState?.gameState?.grid) {
      return roomState.gameState.grid
    }
    if (gameState?.gameState) {
      return gameState.gameState
    }
    if (initialGrid) {
      return initialGrid
    }
    // Return empty 9x9 grid
    return Array(9).fill(null).map(() => Array(9).fill(0))
  }

  const handleGridChange = (newGrid: (number | null)[][]) => {
    // Find the changed cell and send the move
    const currentGrid = getCurrentGameGrid()
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const oldValue = currentGrid[row]?.[col] || 0
        const newValue = newGrid[row][col] || 0
        if (oldValue !== newValue) {
          if (oldValue === 0) { // Only allow changes to empty cells
            makeMove(row, col, newValue)
          }
          return
        }
      }
    }
  }

  const handleLeaveGame = () => {
    leaveGame()
    router.push('/dashboard')
  }

  const handleToggleReady = () => {
    const newReadyState = !isPlayerReady
    console.log('Toggle ready:', { newReadyState, matchId, userId: session?.user?.id })
    setIsPlayerReady(newReadyState)
    setReady(newReadyState)
  }

  const handleRequestHint = () => {
    requestHint()
  }

  const handleSurrender = () => {
    if (showSurrenderConfirm) {
      surrender()
      setShowSurrenderConfirm(false)
    } else {
      setShowSurrenderConfirm(true)
    }
  }

  const handleSendMessage = () => {
    if (chatMessage.trim()) {
      sendMessage(chatMessage.trim())
      setChatMessage('')
    }
  }

  const isMyTurn = () => {
    if (!gameState) return false
    const myPlayerIndex = gameState.players.indexOf(session?.user?.id || '')
    return myPlayerIndex === gameState.currentPlayer
  }

  const getCurrentPlayer = () => {
    return roomState?.players?.find(p => p.id === session?.user?.id)
  }

  const getGamePhase = () => {
    return roomState?.status || 'WAITING'
  }

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const getGameGrid = () => {
    const currentGrid = getCurrentGameGrid()
    const convertedGrid = convertToSudokuGrid(currentGrid)
    
    return convertedGrid
  }

  if (!session?.user?.id) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="p-6">
            <div className="text-center">
              <div className="mx-auto h-12 w-12 text-yellow-500 mb-4">⚠️</div>
              <h3 className="text-lg font-semibold mb-2">Authentication Required</h3>
              <p className="text-gray-600 mb-4">Please sign in to join the game.</p>
              <Button onClick={() => router.push('/auth/signin')}>
                Sign In
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="p-6">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold mb-2">Connecting...</h3>
              <p className="text-gray-600">Establishing connection to game server.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!gameState && !roomState) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="p-6">
            <div className="text-center">
              <div className="animate-pulse bg-gray-200 h-12 w-12 rounded mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold mb-2">Loading Game...</h3>
              <p className="text-gray-600">Joining game room {matchId}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const currentPlayer = getCurrentPlayer()
  const gamePhase = getGamePhase()
  const gameGrid = getGameGrid()
  const isGameActive = gamePhase === 'IN_PROGRESS'
  const canMakeMove = isGameActive && (roomState?.gameState?.gameMode !== 'TURN_BASED' || isMyTurn())

  // Debug logging
  console.log('GameRoom state:', {
    gamePhase,
    isGameActive,
    canMakeMove,
    roomState: roomState ? {
      status: roomState.status,
      playersCount: roomState.players?.length
    } : null
  })

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Game Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center space-x-2">
              <Trophy className="h-6 w-6 text-yellow-500" />
              <span>Game #{matchId.slice(-8)}</span>
              <Badge variant={gamePhase === 'IN_PROGRESS' ? 'default' : 'secondary'}>
                {gamePhase.replace('_', ' ')}
              </Badge>
            </span>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                {isConnected ? (
                  <Wifi className="h-4 w-4 text-green-500" />
                ) : (
                  <WifiOff className="h-4 w-4 text-red-500" />
                )}
                <span className="text-sm text-gray-600">
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              {isGameActive && (
                <div className="flex items-center space-x-1">
                  <Timer className="h-4 w-4" />
                  <span className="font-mono text-sm">
                    {formatTime(timeLeft)}
                  </span>
                </div>
              )}
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sudoku Grid */}
        <div className="lg:col-span-3">
          <Card>
            <CardContent className="p-6">
              <SudokuGridComponent
                grid={gameGrid}
                onGridChange={handleGridChange}
                isReadonly={!canMakeMove}
              />
            </CardContent>
          </Card>
        </div>

        {/* Game Info Sidebar */}
        <div className="space-y-4">
          {/* Player Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Users className="h-5 w-5" />
                <span>Players ({roomState?.players?.length || gameState?.players?.length || 0})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {roomState?.players?.map((player) => (
                <div key={player.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                  <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-1">
                      <div className={`w-2 h-2 rounded-full ${player.isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                      {player.isReady && <CheckCircle className="h-4 w-4 text-green-500" />}
                    </div>
                    <span className="text-sm font-medium">
                      {player.id === session?.user?.id ? 'You' : player.name}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline">
                      Score: {player.score}
                    </Badge>
                    {player.hintsRemaining !== undefined && (
                      <Badge variant="secondary">
                        {player.hintsRemaining} hints
                      </Badge>
                    )}
                  </div>
                </div>
              )) || gameState?.players?.map((playerId, index) => (
                <div key={playerId} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                  <div className="flex items-center space-x-2">
                    {index === gameState.currentPlayer && (
                      <Crown className="h-4 w-4 text-yellow-500" />
                    )}
                    <span className="text-sm font-medium">
                      {playerId === session?.user?.id ? 'You' : `Player ${index + 1}`}
                    </span>
                  </div>
                  <Badge variant="outline">
                    {index === gameState.currentPlayer ? 'Active' : 'Waiting'}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Game Controls */}
          <Card>
            <CardContent className="p-4 space-y-3">
              {gamePhase === 'WAITING' && (
                <Button 
                  onClick={handleToggleReady}
                  variant={isPlayerReady ? "default" : "outline"}
                  className="w-full"
                >
                  {isPlayerReady ? 'Ready!' : 'Ready Up'}
                </Button>
              )}
              
              {isGameActive && (
                <>
                  <Button 
                    onClick={handleRequestHint}
                    variant="outline"
                    className="w-full"
                    disabled={!currentPlayer || currentPlayer.hintsRemaining === 0}
                  >
                    <Lightbulb className="h-4 w-4 mr-2" />
                    Request Hint ({currentPlayer?.hintsRemaining || 0} left)
                  </Button>
                  
                  <Button 
                    onClick={handleSurrender}
                    variant={showSurrenderConfirm ? "destructive" : "outline"}
                    className="w-full"
                  >
                    <Flag className="h-4 w-4 mr-2" />
                    {showSurrenderConfirm ? 'Confirm Surrender' : 'Surrender'}
                  </Button>
                  
                  {showSurrenderConfirm && (
                    <Button 
                      onClick={() => setShowSurrenderConfirm(false)}
                      variant="outline"
                      className="w-full"
                    >
                      Cancel
                    </Button>
                  )}
                </>
              )}
              
              <Button 
                variant="outline" 
                onClick={handleLeaveGame}
                className="w-full"
              >
                Leave Game
              </Button>
            </CardContent>
          </Card>

          {/* Chat */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center space-x-2">
                  <MessageCircle className="h-4 w-4" />
                  <span className="text-sm">Chat</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setChatVisible(!chatVisible)}
                >
                  {chatVisible ? 'Hide' : 'Show'}
                </Button>
              </CardTitle>
            </CardHeader>
            {chatVisible && (
              <CardContent>
                <div className="space-y-2">
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {messages.slice(-10).map((message, index) => (
                      <p key={index} className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                        {message}
                      </p>
                    ))}
                    {messages.length === 0 && (
                      <p className="text-xs text-gray-400 italic">
                        No messages yet...
                      </p>
                    )}
                  </div>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Type a message..."
                      className="flex-1 px-2 py-1 text-xs border rounded"
                    />
                    <Button size="sm" onClick={handleSendMessage}>
                      Send
                    </Button>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default GameRoom
