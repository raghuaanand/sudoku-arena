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
    sendMessage,
    chatMessages
  } = useSocket()
  
  const [messages, setMessages] = useState<string[]>([])
  const [timeLeft, setTimeLeft] = useState<number>(1800) // 30 minutes default
  const [chatVisible, setChatVisible] = useState(false)
  const [isPlayerReady, setIsPlayerReady] = useState(false)
  const [showSurrenderConfirm, setShowSurrenderConfirm] = useState(false)
  const [chatMessage, setChatMessage] = useState('')
  const [initialGrid, setInitialGrid] = useState<number[][] | null>(null)
  const [currentGrid, setCurrentGrid] = useState<(number | null)[][] | null>(null) // Track current state for single player
  const [solutionGrid, setSolutionGrid] = useState<number[][] | null>(null) // Store solution for hints
  const [hintsRemaining, setHintsRemaining] = useState(3)
  const [hintCells, setHintCells] = useState<Set<string>>(new Set()) // Track cells filled by hints
  const [score, setScore] = useState(0) // Current score
  const [gameCompleted, setGameCompleted] = useState(false)
  const [finalTimeSpent, setFinalTimeSpent] = useState<number>(0) // Time spent when game was submitted
  const [revealedSolution, setRevealedSolution] = useState<Set<string>>(new Set()) // Cells revealed after submit
  const [gameResult, setGameResult] = useState<{ 
    correct: number; 
    total: number; 
    errors: number; 
    empty: number;
    time: number; 
    score: number;
    hintsUsed: number;
  } | null>(null)
  const [matchData, setMatchData] = useState<{
    id: string
    type: 'SINGLE_PLAYER' | 'MULTIPLAYER_FREE' | 'MULTIPLAYER_PAID'
    status: string
    sudokuGrid: string
    solution: string
    player1: { id: string; name: string | null; image: string | null }
    player2: { id: string; name: string | null; image: string | null } | null
  } | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const isSinglePlayer = matchData?.type === 'SINGLE_PLAYER'

  const addMessage = useCallback((message: string) => {
    setMessages(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`])
  }, [])

  // Fetch match data first - this determines if it's single player or multiplayer
  useEffect(() => {
    const fetchMatchData = async () => {
      try {
        const response = await fetch(`/api/matches/${matchId}`)
        if (response.ok) {
          const data = await response.json()
          console.log('Match data loaded:', data)
          setMatchData(data.match)
          
          if (data.match?.sudokuGrid) {
            const parsedGrid = JSON.parse(data.match.sudokuGrid)
            console.log('Parsed initial grid:', parsedGrid)
            console.log('Grid type check - first cell:', parsedGrid[0][0], 'type:', typeof parsedGrid[0][0])
            setInitialGrid(parsedGrid)
            
            // Convert to (number | null)[][] format for both single and multiplayer
            const convertedGrid = parsedGrid.map((row: number[]) => 
              row.map((cell: number) => cell === 0 ? null : cell)
            )
            console.log('Converted current grid:', convertedGrid)
            setCurrentGrid(convertedGrid)
            
            // Read time limit from sessionStorage (for single player custom time)
            const storedTimeLimit = sessionStorage.getItem(`match_${matchId}_timeLimit`)
            if (storedTimeLimit) {
              setTimeLeft(parseInt(storedTimeLimit, 10))
              sessionStorage.removeItem(`match_${matchId}_timeLimit`) // Clean up
            }
          }
          
          // Parse and store solution for hints
          if (data.match?.solution) {
            const parsedSolution = JSON.parse(data.match.solution)
            console.log('Parsed solution grid:', parsedSolution)
            setSolutionGrid(parsedSolution)
          } else {
            console.warn('No solution in match data!')
          }
        } else {
          console.error('Failed to fetch match:', response.status)
          addMessage('Error loading match data')
        }
      } catch (error) {
        console.error('Failed to fetch match data:', error)
        addMessage('Error loading match data')
      } finally {
        setIsLoading(false)
      }
    }

    if (matchId && session?.user?.id) {
      fetchMatchData()
    }
  }, [matchId, session?.user?.id, addMessage])

  // Join socket room only for multiplayer games
  useEffect(() => {
    if (!session?.user?.id) {
      router.push('/auth/signin')
      return
    }

    // Only join socket room if we have match data and it's multiplayer
    // For single player, we don't need socket communication
    if (socket && isConnected && matchData && !isSinglePlayer) {
      socket.emit('join-game', {
        matchId,
        userId: session.user.id,
        playerName: session.user.name || session.user.email || 'Player',
        matchType: matchData.type
      })
    }
  }, [socket, isConnected, matchId, matchData, isSinglePlayer, router, session?.user?.id, session?.user?.name, session?.user?.email])

  // Handle Socket events for UI updates
  useEffect(() => {
    if (!socket) return

    const handlePlayerJoined = (data: { userId: string; playerName: string; player?: { name: string } }) => {
      const name = data.playerName || data.player?.name || 'A player'
      addMessage(`${name} joined the game`)
    }

    const handlePlayerLeft = (data: { userId: string; playerName: string }) => {
      addMessage(`${data.playerName} left the game`)
    }

    const handleMoveMade = (data: { row: number; col: number; value: number; playerName: string }) => {
      addMessage(`${data.playerName} made a move: (${data.row + 1}, ${data.col + 1}) = ${data.value}`)
    }
    
    const handleGameState = (data: { players?: { id: string; name: string }[]; status?: string }) => {
      console.log('GameRoom received game-state:', data)
      // Force re-render by logging player count
      if (data.players) {
        console.log(`Players in room: ${data.players.length}`)
      }
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
    socket.on('game-state', handleGameState)
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
      socket.off('game-state', handleGameState)
      socket.off('game-started')
      socket.off('game-paused')
      socket.off('game-resumed')
      socket.off('player-surrendered')
    }
  }, [socket, session, addMessage])

  // Sync grid from roomState if not already loaded from API
  useEffect(() => {
    if (!isSinglePlayer && roomState?.gameState?.grid && !currentGrid) {
      console.log('Syncing grid from roomState:', roomState.gameState.grid)
      const grid = roomState.gameState.grid
      setInitialGrid(grid)
      const convertedGrid = grid.map((row: number[]) => 
        row.map((cell: number) => cell === 0 ? null : cell)
      )
      setCurrentGrid(convertedGrid)
      
      if (roomState.gameState.solution) {
        setSolutionGrid(roomState.gameState.solution)
      }
    }
  }, [isSinglePlayer, roomState, currentGrid])

  // Periodic sync for multiplayer when waiting - request room state every 3 seconds
  useEffect(() => {
    if (isSinglePlayer || !socket || !isConnected) return
    
    // Only poll when in WAITING status
    const status = roomState?.status || matchData?.status
    if (status !== 'WAITING') return
    
    const interval = setInterval(() => {
      console.log('Requesting room state sync...')
      socket.emit('request-room-state')
    }, 3000)
    
    return () => clearInterval(interval)
  }, [isSinglePlayer, socket, isConnected, roomState?.status, matchData?.status])

  // Timer effect - works for both single player and multiplayer
  useEffect(() => {
    // For multiplayer, sync with room state time
    if (!isSinglePlayer && roomState?.gameState?.timeRemaining) {
      const currentTime = roomState.gameState.timeRemaining
      if (currentTime !== timeLeft) {
        setTimeLeft(currentTime)
      }
    }

    // Check if game is active (single player uses matchData, multiplayer uses roomState)
    const isActive = isSinglePlayer 
      ? (matchData?.status === 'ONGOING') 
      : (roomState?.status === 'IN_PROGRESS')
    
    // Don't run timer if game completed or not active
    if (!isActive || gameCompleted) return

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
  }, [isSinglePlayer, matchData?.status, roomState?.status, roomState?.gameState?.timeRemaining, addMessage, timeLeft, gameCompleted])

  // Helper functions
  const convertToSudokuGrid = (grid: number[][]): (number | null)[][] => {
    return grid.map(row => 
      row.map(cell => cell === 0 ? null : cell)
    )
  }

  const getCurrentGameGrid = (): number[][] => {
    // For single player, use locally tracked currentGrid
    if (isSinglePlayer && currentGrid) {
      return currentGrid.map(row => row.map(cell => cell ?? 0))
    }
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
    // Always update local state for tracking
    setCurrentGrid(newGrid)
    
    // For single player, that's all we need
    if (isSinglePlayer) {
      return
    }
    
    // For multiplayer, also send the move through socket
    const currentGridData = getCurrentGameGrid()
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const oldValue = currentGridData[row]?.[col] || 0
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
    console.log('Hint requested - state:', { 
      isSinglePlayer, 
      solutionGrid: !!solutionGrid, 
      currentGrid: !!currentGrid, 
      initialGrid: !!initialGrid,
      hintsRemaining 
    })
    
    // Hint logic works the same for both single player and multiplayer
    // We use local currentGrid tracking for both
    if (solutionGrid && currentGrid && initialGrid && hintsRemaining > 0) {
      // Find only cells that are: originally empty AND currently empty (not filled by user)
      const emptyCells: { row: number; col: number }[] = []
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          const currentValue = currentGrid[row][col]
          const originalValue = initialGrid[row][col]
          const cellKey = `${row}-${col}`
          
          // Cell must be: originally empty, currently empty (null or 0), and not already hinted
          const isOriginallyEmpty = originalValue === 0 || originalValue === null || originalValue === undefined
          const isCurrentlyEmpty = currentValue === null || currentValue === 0
          const isNotHinted = !hintCells.has(cellKey)
          
          if (isOriginallyEmpty && isCurrentlyEmpty && isNotHinted) {
            emptyCells.push({ row, col })
          }
        }
      }
      
      console.log('Empty cells available for hint:', emptyCells.length)
      
      if (emptyCells.length > 0) {
        // Pick a random empty cell
        const randomCell = emptyCells[Math.floor(Math.random() * emptyCells.length)]
        const correctValue = solutionGrid[randomCell.row][randomCell.col]
        const cellKey = `${randomCell.row}-${randomCell.col}`
        
        // Update the grid with the hint
        const newGrid = currentGrid.map((r, ri) =>
          r.map((c, ci) => 
            ri === randomCell.row && ci === randomCell.col ? correctValue : c
          )
        )
        setCurrentGrid(newGrid)
        setHintsRemaining(prev => prev - 1)
        setHintCells(prev => new Set([...prev, cellKey]))
        // Hints cost 20 points
        setScore(prev => Math.max(0, prev - 20))
        addMessage(`💡 Hint: Cell (${randomCell.row + 1}, ${randomCell.col + 1}) = ${correctValue} (-20 pts)`)
        
        // For multiplayer, also send the hint move through socket
        if (!isSinglePlayer) {
          makeMove(randomCell.row, randomCell.col, correctValue)
        }
      } else {
        addMessage('🎉 All cells are correctly filled!')
      }
      return
    }
    
    // Fallback - try socket hint if local hint didn't work
    if (!isSinglePlayer) {
      requestHint()
    }
  }

  const handleSubmitGame = () => {
    console.log('Submit called - initialGrid:', initialGrid)
    console.log('Submit called - solutionGrid:', solutionGrid)
    console.log('Submit called - currentGrid:', currentGrid)
    
    if (!currentGrid || !solutionGrid || !initialGrid) {
      console.log('Missing grids:', { currentGrid: !!currentGrid, solutionGrid: !!solutionGrid, initialGrid: !!initialGrid })
      addMessage('Error: Game data not fully loaded')
      return
    }
    
    let correct = 0
    let errors = 0
    let empty = 0
    let total = 0
    
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const originalValue = initialGrid[row][col]
        // Only count cells that were originally empty (0 or null or undefined)
        const isOriginallyEmpty = originalValue === 0 || originalValue === null || originalValue === undefined
        
        if (isOriginallyEmpty) {
          total++
          const currentValue = currentGrid[row][col]
          const solutionValue = solutionGrid[row][col]
          const cellKey = `${row}-${col}`
          
          if (currentValue === null || currentValue === 0) {
            empty++
          } else if (currentValue === solutionValue) {
            // Hint cells don't count for points (already deducted when using hint)
            if (!hintCells.has(cellKey)) {
              correct++
            }
          } else {
            errors++
          }
        }
      }
    }
    
    console.log('Scoring result:', { total, correct, errors, empty, hintsUsed: 3 - hintsRemaining })
    
    // Calculate final score
    // +10 points per correct cell, -5 per error, hints already deducted
    const correctPoints = correct * 10
    const errorPenalty = errors * 5
    const finalScore = Math.max(0, score + correctPoints - errorPenalty)
    
    // Calculate time spent
    const storedTimeLimit = sessionStorage.getItem(`match_${matchId}_timeLimit`)
    const initialTime = storedTimeLimit ? parseInt(storedTimeLimit, 10) : 1800
    const timeSpent = initialTime - timeLeft
    
    const hintsUsed = 3 - hintsRemaining
    const totalUserFilled = correct + errors // cells user filled (not counting hints)
    
    setGameResult({ 
      correct, 
      total, 
      errors, 
      empty,
      time: timeSpent, 
      score: finalScore,
      hintsUsed
    })
    setScore(finalScore)
    setFinalTimeSpent(timeSpent)
    setGameCompleted(true)
    
    // Reveal the solution - fill in empty/wrong cells with correct answers
    if (solutionGrid) {
      const revealed = new Set<string>()
      const newGrid = currentGrid.map((row, ri) =>
        row.map((cell, ci) => {
          const originalValue = initialGrid[ri][ci]
          const isOriginallyEmpty = originalValue === 0 || originalValue === null || originalValue === undefined
          if (isOriginallyEmpty) {
            const solutionValue = solutionGrid[ri][ci]
            if (cell !== solutionValue) {
              // This cell was empty or wrong - reveal the solution
              revealed.add(`${ri}-${ci}`)
              return solutionValue
            }
          }
          return cell
        })
      )
      setRevealedSolution(revealed)
      setCurrentGrid(newGrid)
    }
    
    const isPerfect = empty === 0 && errors === 0
    if (isPerfect) {
      addMessage(`🎉 Perfect! All cells correct! Final score: ${finalScore}`)
    } else {
      addMessage(`🎮 Game submitted! Score: ${finalScore} (${correct} correct, ${errors} errors, ${empty} empty)`)
    }
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
    // Single player is always your turn
    if (isSinglePlayer) return true
    if (!gameState) return false
    const myPlayerIndex = gameState.players.indexOf(session?.user?.id || '')
    return myPlayerIndex === gameState.currentPlayer
  }

  const getCurrentPlayer = () => {
    // For single player, create a synthetic player object
    if (isSinglePlayer && session?.user) {
      return {
        id: session.user.id,
        name: session.user.name || session.user.email || 'Player',
        isReady: true,
        isConnected: true,
        score: 0,
        moves: 0,
        hintsUsed: 3 - hintsRemaining,
        hintsRemaining: hintsRemaining
      }
    }
    return roomState?.players?.find(p => p.id === session?.user?.id)
  }

  const getGamePhase = () => {
    // For single player, use match status
    if (isSinglePlayer && matchData) {
      return matchData.status === 'ONGOING' ? 'IN_PROGRESS' : matchData.status
    }
    return roomState?.status || 'WAITING'
  }

  const formatTime = (seconds: number) => {
    // If game completed, show the time spent
    if (gameCompleted && finalTimeSpent > 0) {
      const mins = Math.floor(finalTimeSpent / 60)
      const secs = finalTimeSpent % 60
      return `${mins}:${secs.toString().padStart(2, '0')}`
    }
    // Handle negative or zero values
    if (seconds <= 0) {
      return '0:00'
    }
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const getGameGrid = (): (number | null)[][] => {
    // Use local currentGrid for both single and multiplayer (we track locally now)
    if (currentGrid) {
      return currentGrid
    }
    
    // Fallback for multiplayer - convert from number[][] to (number | null)[][]
    const gridData = getCurrentGameGrid()
    return convertToSudokuGrid(gridData)
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

  // Show loading while fetching match data
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="p-6">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold mb-2">Loading Game...</h3>
              <p className="text-gray-600">Fetching match data...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // For multiplayer, require socket connection
  if (!isSinglePlayer && !isConnected) {
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

  // For single player, we just need the initial grid
  // For multiplayer, we need socket state
  if (isSinglePlayer && !initialGrid) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="p-6">
            <div className="text-center">
              <div className="animate-pulse bg-gray-200 h-12 w-12 rounded mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold mb-2">Loading Puzzle...</h3>
              <p className="text-gray-600">Preparing your game...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isSinglePlayer && !gameState && !roomState) {
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
  // Game is active if single player with ONGOING status, or multiplayer IN_PROGRESS, or just having matchData ONGOING
  const isGameActive = gamePhase === 'IN_PROGRESS' || matchData?.status === 'ONGOING'
  // Allow moves if game is active and not completed - for multiplayer check turn-based mode
  const canMakeMove = isGameActive && !gameCompleted && (isSinglePlayer || roomState?.gameState?.gameMode !== 'TURN_BASED' || isMyTurn())

  // Debug logging
  console.log('GameRoom state:', {
    gamePhase,
    isGameActive,
    canMakeMove,
    isSinglePlayer,
    matchType: matchData?.type,
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
              {isSinglePlayer && (
                <Badge variant="outline" className="ml-2">
                  Solo
                </Badge>
              )}
            </span>
            <div className="flex items-center space-x-4">
              {/* Only show connection status for multiplayer */}
              {!isSinglePlayer && (
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
              )}
              {(isGameActive || gameCompleted) && (
                <div className="flex items-center space-x-1">
                  <Timer className="h-4 w-4" />
                  <span className="font-mono text-sm">
                    {gameCompleted ? `Time: ${formatTime(timeLeft)}` : formatTime(timeLeft)}
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
                originalPuzzle={initialGrid ? convertToSudokuGrid(initialGrid) : undefined}
                onGridChange={handleGridChange}
                isReadonly={!canMakeMove || gameCompleted}
                hintCells={hintCells}
                revealedCells={revealedSolution}
              />
              {/* Legend when game completed */}
              {gameCompleted && (
                <div className="mt-4 flex flex-wrap gap-4 text-sm justify-center">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-card border" />
                    <span className="text-foreground font-bold">Original</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-blue-100 dark:bg-blue-900" />
                    <span className="text-blue-600 dark:text-blue-400">Your entries</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-100 dark:bg-green-900" />
                    <span className="text-green-600 dark:text-green-400">Hints</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-purple-100 dark:bg-purple-900" />
                    <span className="text-purple-600 dark:text-purple-400">Revealed answers</span>
                  </div>
                </div>
              )}
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
                <span>Players ({isSinglePlayer ? 1 : (roomState?.players?.length || gameState?.players?.length || 0)})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Single Player Mode */}
              {isSinglePlayer && currentPlayer && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-foreground">You</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline" className="bg-background">
                      Score: {score}
                    </Badge>
                    <Badge variant="secondary">
                      {hintsRemaining} hints
                    </Badge>
                  </div>
                </div>
              )}
              {/* Multiplayer Mode */}
              {!isSinglePlayer && (roomState?.players?.map((player) => (
                <div key={player.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-1">
                      <div className={`w-2 h-2 rounded-full ${player.isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                      {player.isReady && <CheckCircle className="h-4 w-4 text-green-500" />}
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {player.id === session?.user?.id ? 'You' : player.name}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline" className="bg-background">
                      {/* Use local score for current player */}
                      Score: {player.id === session?.user?.id ? score : player.score}
                    </Badge>
                    <Badge variant="secondary">
                      {/* Use local hints for current player */}
                      {player.id === session?.user?.id ? hintsRemaining : (player.hintsRemaining ?? 3)} hints
                    </Badge>
                  </div>
                </div>
              )) || gameState?.players?.map((playerId, index) => (
                <div key={playerId} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center space-x-2">
                    {index === gameState.currentPlayer && (
                      <Crown className="h-4 w-4 text-yellow-500" />
                    )}
                    <span className="text-sm font-medium text-foreground">
                      {playerId === session?.user?.id ? 'You' : `Player ${index + 1}`}
                    </span>
                  </div>
                  <Badge variant="outline" className="bg-background">
                    {index === gameState.currentPlayer ? 'Active' : 'Waiting'}
                  </Badge>
                </div>
              )))}
            </CardContent>
          </Card>

          {/* Game Controls */}
          <Card>
            <CardContent className="p-4 space-y-3">
              {gamePhase === 'WAITING' && !isSinglePlayer && (
                <Button 
                  onClick={handleToggleReady}
                  variant={isPlayerReady ? "default" : "outline"}
                  className="w-full"
                >
                  {isPlayerReady ? 'Ready!' : 'Ready Up'}
                </Button>
              )}
              
              {isGameActive && !gameCompleted && (
                <>
                  <Button 
                    onClick={handleRequestHint}
                    variant="outline"
                    className="w-full"
                    disabled={hintsRemaining === 0}
                  >
                    <Lightbulb className="h-4 w-4 mr-2" />
                    Request Hint ({hintsRemaining} left)
                  </Button>
                  
                  {/* Submit button for both single player and multiplayer */}
                  <Button 
                    onClick={handleSubmitGame}
                    variant="default"
                    className="w-full bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Submit & Check
                  </Button>
                  
                  {/* Surrender only for multiplayer */}
                  {!isSinglePlayer && (
                    <>
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
                </>
              )}
              
              {/* Show results after submission */}
              {gameCompleted && gameResult && (
                <div className="p-4 rounded-lg bg-muted/50 border space-y-3">
                  <div className="text-center">
                    <h4 className="font-semibold text-lg text-foreground">Game Results</h4>
                    <div className="text-3xl font-bold text-primary mt-1">{gameResult.score} pts</div>
                  </div>
                  <div className="text-sm space-y-1 border-t border-border pt-2">
                    <div className="flex justify-between text-foreground">
                      <span>Correct cells:</span>
                      <span className="font-medium text-green-600 dark:text-green-400">{gameResult.correct} (+{gameResult.correct * 10})</span>
                    </div>
                    <div className="flex justify-between text-foreground">
                      <span>Wrong cells:</span>
                      <span className="font-medium text-destructive">{gameResult.errors} (-{gameResult.errors * 5})</span>
                    </div>
                    <div className="flex justify-between text-foreground">
                      <span>Empty cells:</span>
                      <span className="font-medium text-muted-foreground">{gameResult.empty}</span>
                    </div>
                    <div className="flex justify-between text-foreground">
                      <span>Hints used:</span>
                      <span className="font-medium text-amber-600 dark:text-amber-400">{gameResult.hintsUsed} (-{gameResult.hintsUsed * 20})</span>
                    </div>
                    <div className="flex justify-between border-t border-border pt-1 mt-1 text-foreground">
                      <span>Time:</span>
                      <span className="font-medium">{Math.floor(gameResult.time / 60)}:{(gameResult.time % 60).toString().padStart(2, '0')}</span>
                    </div>
                  </div>
                  {gameResult.empty === 0 && gameResult.errors === 0 ? (
                    <p className="text-center text-green-600 dark:text-green-400 font-semibold bg-green-500/10 border border-green-500/20 p-2 rounded">Perfect! Puzzle Solved!</p>
                  ) : gameResult.empty > 0 ? (
                    <p className="text-center text-amber-600 dark:text-amber-400 font-medium bg-amber-500/10 border border-amber-500/20 p-2 rounded">{gameResult.empty} cells still empty</p>
                  ) : (
                    <p className="text-center text-destructive font-medium bg-destructive/10 border border-destructive/20 p-2 rounded">{gameResult.errors} incorrect cells</p>
                  )}
                </div>
              )}
              
              <Button 
                variant="outline" 
                onClick={handleLeaveGame}
                className="w-full"
              >
                {gameCompleted ? 'Back to Dashboard' : 'Leave Game'}
              </Button>
            </CardContent>
          </Card>

          {/* Chat - Only show for multiplayer */}
          {!isSinglePlayer && (
            <Card className="bg-gray-900 border-gray-700">
              <CardHeader className="pb-2">
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
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    <div className="max-h-32 overflow-y-auto space-y-1 bg-gray-800 rounded p-2">
                      {chatMessages.slice(-10).map((msg, index) => (
                        <div key={index} className="text-xs">
                          <span className="text-yellow-500 font-medium">{msg.playerName}: </span>
                          <span className="text-gray-300">{msg.message}</span>
                        </div>
                      ))}
                      {chatMessages.length === 0 && (
                        <p className="text-xs text-gray-500 italic">
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
                        className="flex-1 px-3 py-2 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:border-yellow-500"
                      />
                      <Button size="sm" onClick={handleSendMessage} className="bg-yellow-500 hover:bg-yellow-600 text-black">
                        Send
                      </Button>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export default GameRoom
