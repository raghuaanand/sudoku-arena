'use client'

import React, { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Users, 
  Clock, 
  Trophy, 
  ChevronLeft, 
  Bot,
  Crown,
  Play,
  Sparkles,
  Target,
  Wallet,
  Grid3X3,
} from 'lucide-react'

interface MatchMakingProps {
  gameMode: 'SINGLE' | 'MULTIPLAYER_FREE' | 'PAID_TOURNAMENT'
  onBack: () => void
}

export function MatchMaking({ gameMode, onBack }: MatchMakingProps) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [isSearching, setIsSearching] = useState(false)
  const [matchFound, setMatchFound] = useState(false)

  const handleStartGame = async () => {
    if (!session?.user?.id) {
      router.push('/auth/signin')
      return
    }
    
    setIsSearching(true)
    
    try {
      const typeMapping = {
        'SINGLE': 'SINGLE_PLAYER',
        'MULTIPLAYER_FREE': 'MULTIPLAYER_FREE', 
        'PAID_TOURNAMENT': 'MULTIPLAYER_PAID'
      }
      
      const response = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: typeMapping[gameMode],
          entryFee: gameMode === 'PAID_TOURNAMENT' ? 100 : 0,
          difficulty: 'medium'
        })
      })
      
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `Failed to create match`)
      }

      const data = await response.json()
      
      if (gameMode === 'SINGLE') {
        if (data.match?.id) {
          router.push(`/game/${data.match.id}`)
        } else {
          throw new Error('Invalid match response')
        }
      } else {
        if (data.status === 'matched' && data.match?.id) {
          router.push(`/game/${data.match.id}`)
        } else if (data.status === 'queued') {
          setMatchFound(true)
          setTimeout(() => {
            alert('Still waiting for opponent. Please try again later.')
            onBack()
          }, 5000)
        } else if (data.match?.id) {
          setMatchFound(true)
          setTimeout(() => {
            router.push(`/game/${data.match.id}`)
          }, 3000)
        } else {
          throw new Error('Invalid match response')
        }
      }
    } catch (error) {
      console.error('Error creating match:', error)
      setIsSearching(false)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      alert(`Failed to create match: ${errorMessage}`)
    }
  }

  const gameModeInfo = {
    SINGLE: {
      title: 'Solo Practice',
      description: 'Play against yourself with no time pressure',
      icon: Bot,
      players: '1 Player',
      entryFee: 'Free',
      prize: 'Experience Points',
      iconBg: 'bg-primary/10 text-primary',
    },
    MULTIPLAYER_FREE: {
      title: 'Free Match',
      description: 'Challenge other players in real-time',
      icon: Users,
      players: '2 Players',
      entryFee: 'Free',
      prize: 'Ranking Points',
      iconBg: 'bg-accent/10 text-accent',
    },
    PAID_TOURNAMENT: {
      title: 'Prize Match',
      description: 'Compete for real money prizes',
      icon: Crown,
      players: '2-8 Players',
      entryFee: '₹100',
      prize: '₹500 - ₹5000',
      iconBg: 'bg-primary text-primary-foreground',
    },
  }

  const info = gameModeInfo[gameMode]
  const Icon = info.icon

  // Loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-muted border-t-primary animate-spin mx-auto" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  // Not authenticated
  if (status === 'unauthenticated' || !session?.user?.id) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card variant="elevated" className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <Grid3X3 className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-2">Sign In Required</h2>
              <p className="text-muted-foreground">Please sign in to start playing</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onBack} className="flex-1">
                Go Back
              </Button>
              <Button onClick={() => router.push('/auth/signin')} className="flex-1">
                Sign In
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Searching state
  if (isSearching) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card variant="elevated" className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-6">
            <div className={`w-16 h-16 rounded-2xl ${info.iconBg} flex items-center justify-center mx-auto`}>
              <Icon className="w-8 h-8" />
            </div>
            
            <div>
              <h2 className="text-xl font-semibold mb-2">
                {matchFound ? 'Match Found!' : 'Finding Players...'}
              </h2>
              <p className="text-muted-foreground">
                {matchFound ? 'Preparing your game room' : `Searching for ${info.players.toLowerCase()}`}
              </p>
            </div>

            <div className="flex items-center justify-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-muted border-t-primary animate-spin" />
              <span className="text-muted-foreground">
                {matchFound ? 'Starting game...' : 'Please wait...'}
              </span>
            </div>

            {!matchFound && gameMode !== 'SINGLE' && (
              <div className="space-y-3 pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Players found</span>
                  <Badge>1/{gameMode === 'PAID_TOURNAMENT' ? '8' : '2'}</Badge>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full w-1/2 animate-pulse" />
                </div>
              </div>
            )}

            {!matchFound && (
              <Button variant="ghost" onClick={() => { setIsSearching(false); onBack(); }}>
                Cancel Search
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  // Main view
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <header className="nav-header">
        <div className="container-default">
          <div className="flex h-16 items-center">
            <Button variant="ghost" onClick={onBack} className="gap-2">
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>
          </div>
        </div>
      </header>

      <main className="container-tight py-8">
        <Card variant="elevated" className="animate-fade-in-up">
          <CardHeader className="text-center pb-6">
            <div className={`w-20 h-20 rounded-2xl ${info.iconBg} flex items-center justify-center mx-auto mb-4`}>
              <Icon className="w-10 h-10" />
            </div>
            <CardTitle className="text-2xl">{info.title}</CardTitle>
            <CardDescription className="text-base">{info.description}</CardDescription>
          </CardHeader>

          <CardContent className="space-y-8">
            {/* Game Details */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-xl bg-muted/50">
                <Users className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                <div className="font-semibold">{info.players}</div>
                <div className="text-xs text-muted-foreground">Players</div>
              </div>
              <div className="text-center p-4 rounded-xl bg-muted/50">
                <Wallet className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                <div className="font-semibold">{info.entryFee}</div>
                <div className="text-xs text-muted-foreground">Entry Fee</div>
              </div>
              <div className="text-center p-4 rounded-xl bg-muted/50">
                <Trophy className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                <div className="font-semibold">{info.prize}</div>
                <div className="text-xs text-muted-foreground">Prize</div>
              </div>
            </div>

            {/* Game Rules */}
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Target className="w-4 h-4 text-muted-foreground" />
                Game Rules
              </h3>
              <ul className="space-y-3">
                {[
                  'Fill the 9×9 grid with digits 1-9',
                  'Each row, column, and 3×3 box must contain all digits 1-9',
                  'First player to complete the puzzle wins',
                  gameMode !== 'SINGLE' && 'Game has a 30-minute time limit',
                  gameMode === 'PAID_TOURNAMENT' && 'Winner takes the prize pool',
                ].filter(Boolean).map((rule, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                    {rule}
                  </li>
                ))}
              </ul>
            </div>

            {/* Warning for paid tournament */}
            {gameMode === 'PAID_TOURNAMENT' && (
              <div className="p-4 rounded-xl bg-warning/10 border border-warning/20">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium mb-1">
                  <Wallet className="w-4 h-4" />
                  Entry Fee Required
                </div>
                <p className="text-sm text-muted-foreground">
                  ₹100 will be deducted from your wallet when you join.
                </p>
              </div>
            )}

            {/* Start Button */}
            <Button 
              onClick={handleStartGame}
              variant="premium"
              size="xl"
              className="w-full"
            >
              <Play className="w-5 h-5" />
              {gameMode === 'SINGLE' ? 'Start Practice' : 
               gameMode === 'MULTIPLAYER_FREE' ? 'Find Match' : 
               'Join Tournament'}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

