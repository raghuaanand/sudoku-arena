'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MatchMaking } from '@/components/MatchMaking'
import {
  Trophy,
  Users,
  Bot,
  Wallet,
  Play,
  Crown,
  LogOut,
  BarChart3,
  Settings,
  Zap,
  Sparkles,
  TrendingUp,
  Award,
  Grid3X3,
  ChevronRight,
  ArrowUpRight,
  Clock,
  Target,
  Plus,
} from 'lucide-react'

function DashboardContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedGameMode, setSelectedGameMode] = useState<'SINGLE' | 'MULTIPLAYER_FREE' | 'PAID_TOURNAMENT' | null>(null)
  const [walletBalance, setWalletBalance] = useState<number>(0)
  const [loadingWallet, setLoadingWallet] = useState(true)

  useEffect(() => {
    if (status === 'loading') return
    if (!session) router.push('/auth/signin')

    const mode = searchParams.get('mode')
    if (mode && session) {
      switch (mode) {
        case 'ai':
          setSelectedGameMode('SINGLE')
          break
        case 'multiplayer':
          setSelectedGameMode('MULTIPLAYER_FREE')
          break
        case 'tournament':
          setSelectedGameMode('PAID_TOURNAMENT')
          break
      }
    }

    if (session?.user?.id) {
      fetchWalletBalance()
    }
  }, [session, status, router, searchParams])

  const fetchWalletBalance = async () => {
    try {
      const response = await fetch('/api/wallet')
      if (response.ok) {
        const data = await response.json()
        setWalletBalance(data.balance || 0)
      }
    } catch (error) {
      console.error('Error fetching wallet balance:', error)
    } finally {
      setLoadingWallet(false)
    }
  }

  if (status === 'loading') {
    return <LoadingState />
  }

  if (!session) {
    return null
  }

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/' })
  }

  if (selectedGameMode) {
    return (
      <MatchMaking
        gameMode={selectedGameMode}
        onBack={() => setSelectedGameMode(null)}
      />
    )
  }

  const firstName = session.user?.name?.split(' ')[0] || 'Player'

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <header className="nav-header">
        <div className="container-default">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary text-primary-foreground">
                  <Grid3X3 className="w-5 h-5" />
                </div>
                <span className="text-lg font-semibold tracking-tight">Sudoku Arena</span>
              </Link>
            </div>

            <div className="flex items-center gap-3">
              <Link href="/wallet">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Wallet className="w-4 h-4" />
                  <span className="font-semibold">
                    {loadingWallet ? '...' : `₹${walletBalance.toFixed(0)}`}
                  </span>
                </Button>
              </Link>
              
              <div className="divider-vertical h-6" />
              
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                  {firstName[0]}
                </div>
                <span className="hidden sm:block text-sm font-medium">{firstName}</span>
              </div>
              
              <Button variant="ghost" size="icon-sm" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container-default py-8 space-y-8">
        {/* Welcome Section */}
        <div className="space-y-2 animate-fade-in-up">
          <h1 className="text-heading text-3xl sm:text-4xl">
            Welcome back, {firstName}
          </h1>
          <p className="text-foreground-secondary text-lg">
            Ready to solve some puzzles? Choose your game mode below.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in-up stagger-1">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <Link href="/wallet">
                <Button variant="ghost" size="icon-sm">
                  <ArrowUpRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Wallet Balance</p>
              <p className="text-2xl font-bold">
                {loadingWallet ? (
                  <span className="skeleton inline-block w-20 h-7" />
                ) : (
                  `₹${walletBalance.toFixed(2)}`
                )}
              </p>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Play className="w-5 h-5 text-accent" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Games Played</p>
              <p className="text-2xl font-bold">0</p>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                <Trophy className="w-5 h-5 text-success" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Victories</p>
              <p className="text-2xl font-bold">0</p>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-amber-600" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Win Rate</p>
              <p className="text-2xl font-bold">—</p>
            </div>
          </Card>
        </div>

        {/* Game Modes */}
        <div className="space-y-4 animate-fade-in-up stagger-2">
          <div className="flex items-center justify-between">
            <h2 className="text-heading text-xl">Play Now</h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Training */}
            <Card variant="interactive" className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Bot className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Training</h3>
                  <p className="text-sm text-muted-foreground">Practice vs AI</p>
                </div>
              </div>
              <p className="text-sm text-foreground-secondary mb-6">
                Sharpen your skills against intelligent AI across multiple difficulty levels.
              </p>
              <Button 
                onClick={() => router.push('/create-match')}
                className="w-full"
              >
                <Play className="w-4 h-4" />
                Start Training
              </Button>
            </Card>

            {/* PvP */}
            <Card variant="interactive" className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center">
                  <Users className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">PvP Match</h3>
                  <p className="text-sm text-muted-foreground">Real-time battles</p>
                </div>
              </div>
              <p className="text-sm text-foreground-secondary mb-6">
                Challenge players worldwide in intense real-time competitive matches.
              </p>
              <Button 
                onClick={() => router.push('/create-match')}
                variant="outline"
                className="w-full"
              >
                <Users className="w-4 h-4" />
                Find Match
              </Button>
            </Card>

            {/* Tournaments */}
            <Card variant="highlight" className="p-6">
              <Badge className="absolute top-4 right-4">Premium</Badge>
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary-light flex items-center justify-center">
                  <Crown className="w-6 h-6 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Tournaments</h3>
                  <p className="text-sm text-muted-foreground">Win cash prizes</p>
                </div>
              </div>
              <p className="text-sm text-foreground-secondary mb-6">
                Compete in professional tournaments for substantial cash rewards.
              </p>
              <Button 
                onClick={() => router.push('/tournaments')}
                variant="premium"
                className="w-full"
              >
                <Trophy className="w-4 h-4" />
                View Tournaments
              </Button>
            </Card>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-4 animate-fade-in-up stagger-3">
          <h2 className="text-heading text-xl">Quick Actions</h2>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { icon: Plus, label: 'New Match', href: '/create-match' },
              { icon: Trophy, label: 'Tournaments', href: '/tournaments' },
              { icon: BarChart3, label: 'Leaderboard', href: '/leaderboard' },
              { icon: Wallet, label: 'Wallet', href: '/wallet' },
              { icon: Clock, label: 'Matches', href: '/matches' },
              { icon: Settings, label: 'Admin', href: '/admin' },
            ].map((action, i) => (
              <Link key={i} href={action.href}>
                <Card variant="interactive" className="p-4 text-center h-full">
                  <action.icon className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
                  <span className="text-sm font-medium">{action.label}</span>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <Card className="animate-fade-in-up stagger-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              Recent Activity
            </CardTitle>
            <CardDescription>Your latest matches and achievements</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                <Play className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-2">No activity yet</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
                Start playing to see your match history and achievements here.
              </p>
              <Button onClick={() => router.push('/create-match')}>
                <Sparkles className="w-4 h-4" />
                Play Your First Game
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 rounded-full border-2 border-muted border-t-primary animate-spin mx-auto" />
        <div className="space-y-1">
          <p className="font-semibold">Loading Dashboard</p>
          <p className="text-sm text-muted-foreground">Preparing your arena...</p>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DashboardContent />
    </Suspense>
  )
}
