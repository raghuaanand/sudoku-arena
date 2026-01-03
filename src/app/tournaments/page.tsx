'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Trophy, 
  Users, 
  Clock, 
  Wallet,
  Calendar,
  Crown,
  ArrowRight,
  Grid3X3,
  ChevronLeft,
  Sparkles,
  Target,
  Shield,
} from 'lucide-react'
import { Tournament } from '@/lib/tournament'

export default function TournamentsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [walletBalance, setWalletBalance] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.user?.id) {
      router.push('/auth/signin')
      return
    }
    
    fetchTournaments()
    fetchWalletBalance()
  }, [session, router])

  const fetchTournaments = async () => {
    try {
      const response = await fetch('/api/tournaments')
      if (response.ok) {
        const data = await response.json()
        setTournaments(data.tournaments || [])
      } else {
        // Mock data fallback
        setTournaments([
          {
            id: '1',
            name: 'Daily Championship',
            entryFee: 100,
            prizePool: 5000,
            maxPlayers: 16,
            currentPlayers: 8,
            status: 'REGISTRATION',
            startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            description: 'Daily tournament with exciting prizes!',
            bracketType: 'SINGLE_ELIMINATION',
            currentRound: 0,
            totalRounds: 4,
            players: [],
            matches: []
          },
          {
            id: '2',
            name: 'Weekend Warrior',
            entryFee: 50,
            prizePool: 2000,
            maxPlayers: 8,
            currentPlayers: 5,
            status: 'REGISTRATION',
            startTime: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
            description: 'Perfect for weekend players!',
            bracketType: 'SINGLE_ELIMINATION',
            currentRound: 0,
            totalRounds: 3,
            players: [],
            matches: []
          },
          {
            id: '3',
            name: 'Mega Tournament',
            entryFee: 200,
            prizePool: 10000,
            maxPlayers: 32,
            currentPlayers: 20,
            status: 'REGISTRATION',
            startTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            description: 'The biggest tournament of the month!',
            bracketType: 'SINGLE_ELIMINATION',
            currentRound: 0,
            totalRounds: 5,
            players: [],
            matches: []
          },
        ])
      }
    } catch (error) {
      console.error('Error fetching tournaments:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchWalletBalance = async () => {
    try {
      const response = await fetch('/api/wallet')
      if (response.ok) {
        const data = await response.json()
        setWalletBalance(data.balance || 0)
      }
    } catch (error) {
      console.error('Error fetching wallet balance:', error)
    }
  }

  const getStatusBadge = (status: Tournament['status']) => {
    switch (status) {
      case 'REGISTRATION':
        return <Badge variant="success">Open</Badge>
      case 'IN_PROGRESS':
        return <Badge variant="warning">Live</Badge>
      case 'COMPLETED':
        return <Badge variant="muted">Ended</Badge>
      default:
        return <Badge variant="muted">Unknown</Badge>
    }
  }

  const canJoinTournament = (tournament: Tournament) => {
    return tournament.status === 'REGISTRATION' && 
           tournament.currentPlayers < tournament.maxPlayers &&
           walletBalance >= tournament.entryFee
  }

  const handleJoinTournament = async (tournament: Tournament) => {
    if (!canJoinTournament(tournament)) {
      if (walletBalance < tournament.entryFee) {
        alert(`Insufficient balance. You need ₹${tournament.entryFee} to join.`)
        router.push('/wallet')
      }
      return
    }

    try {
      const response = await fetch(`/api/tournaments/${tournament.id}/join`, {
        method: 'POST'
      })

      if (response.ok) {
        alert('Successfully joined tournament!')
        fetchWalletBalance()
        fetchTournaments()
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to join tournament')
      }
    } catch (error) {
      console.error('Error joining tournament:', error)
      alert('Failed to join tournament')
    }
  }

  const formatTimeUntil = (timeString: string) => {
    const date = new Date(timeString)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()
    
    if (diffMs < 0) return 'Started'
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  if (!session?.user?.id) return null

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-muted border-t-primary animate-spin mx-auto" />
          <p className="text-muted-foreground">Loading tournaments...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <header className="nav-header">
        <div className="container-default">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <Button variant="ghost" size="icon-sm">
                  <ChevronLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary text-primary-foreground">
                  <Trophy className="w-5 h-5" />
                </div>
                <span className="text-lg font-semibold">Tournaments</span>
              </div>
            </div>

            <Link href="/wallet">
              <Button variant="ghost" size="sm" className="gap-2">
                <Wallet className="w-4 h-4" />
                <span className="font-semibold">₹{walletBalance.toFixed(0)}</span>
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container-default py-8 space-y-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto animate-fade-in-up">
          <Badge variant="default" size="lg" className="mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            Premium Competition
          </Badge>
          <h1 className="text-heading text-3xl sm:text-4xl mb-4">
            Compete for Real Prizes
          </h1>
          <p className="text-foreground-secondary text-lg">
            Join bracket tournaments and win cash prizes. Entry fees build the prize pool.
          </p>
        </div>

        {/* Tournament Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in-up stagger-1">
          {tournaments.map((tournament) => {
            const progress = (tournament.currentPlayers / tournament.maxPlayers) * 100
            
            return (
              <Card key={tournament.id} variant="interactive" className="overflow-hidden">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between mb-2">
                    <CardTitle className="text-xl">{tournament.name}</CardTitle>
                    {getStatusBadge(tournament.status)}
                  </div>
                  <p className="text-sm text-muted-foreground">{tournament.description}</p>
                </CardHeader>

                <CardContent className="space-y-6">
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded-xl bg-muted/50">
                      <Trophy className="w-4 h-4 text-primary mb-2" />
                      <p className="text-xs text-muted-foreground">Prize Pool</p>
                      <p className="font-semibold">₹{tournament.prizePool.toLocaleString()}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/50">
                      <Wallet className="w-4 h-4 text-primary mb-2" />
                      <p className="text-xs text-muted-foreground">Entry Fee</p>
                      <p className="font-semibold">₹{tournament.entryFee}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/50">
                      <Users className="w-4 h-4 text-accent mb-2" />
                      <p className="text-xs text-muted-foreground">Players</p>
                      <p className="font-semibold">{tournament.currentPlayers}/{tournament.maxPlayers}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/50">
                      <Clock className="w-4 h-4 text-accent mb-2" />
                      <p className="text-xs text-muted-foreground">Starts In</p>
                      <p className="font-semibold">{formatTimeUntil(tournament.startTime)}</p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Registration</span>
                      <span className="font-medium">{Math.round(progress)}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Action Button */}
                  <Button
                    onClick={() => handleJoinTournament(tournament)}
                    disabled={!canJoinTournament(tournament)}
                    variant={tournament.status === 'REGISTRATION' ? 'premium' : 'outline'}
                    className="w-full"
                  >
                    {tournament.status === 'COMPLETED' ? (
                      'Ended'
                    ) : tournament.currentPlayers >= tournament.maxPlayers ? (
                      'Full'
                    ) : walletBalance < tournament.entryFee ? (
                      `Need ₹${tournament.entryFee - walletBalance} more`
                    ) : tournament.status === 'IN_PROGRESS' ? (
                      <>View Bracket<ArrowRight className="w-4 h-4" /></>
                    ) : (
                      <>Join Tournament<ArrowRight className="w-4 h-4" /></>
                    )}
                  </Button>

                  {/* Start Time */}
                  {tournament.status === 'REGISTRATION' && (
                    <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(tournament.startTime).toLocaleDateString('en-IN', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Rules Section */}
        <Card className="animate-fade-in-up stagger-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-muted-foreground" />
              Tournament Rules
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h4 className="font-semibold flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  How It Works
                </h4>
                <ul className="space-y-3">
                  {[
                    'Single elimination bracket format',
                    'Each round has a 30-minute time limit',
                    'First to complete the puzzle wins',
                    'Winner takes 70%, runner-up gets 30%',
                  ].map((rule, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-foreground-secondary">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2" />
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-4">
                <h4 className="font-semibold flex items-center gap-2">
                  <Shield className="w-4 h-4 text-accent" />
                  Entry Requirements
                </h4>
                <ul className="space-y-3">
                  {[
                    'Sufficient wallet balance for entry fee',
                    'Tournament must be in registration phase',
                    'Verified account required',
                    'Fair play policy applies',
                  ].map((rule, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-foreground-secondary">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent mt-2" />
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
