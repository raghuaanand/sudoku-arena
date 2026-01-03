'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Users, 
  Trophy, 
  Clock, 
  Wallet, 
  Play, 
  Zap, 
  ChevronLeft,
  Grid3X3,
  Bot,
  ArrowRight,
  Shield,
  Target,
  Sparkles,
} from 'lucide-react'

export default function CreateMatchPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [isCreating, setIsCreating] = useState(false)
  const [selectedType, setSelectedType] = useState<string | null>(null)

  const createMatch = async (type: 'SINGLE_PLAYER' | 'MULTIPLAYER_FREE' | 'MULTIPLAYER_PAID', entryFee: number = 0) => {
    if (!session?.user?.id) {
      router.push('/auth/signin')
      return
    }

    setIsCreating(true)
    setSelectedType(type)

    try {
      const response = await fetch('/api/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, entryFee }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Response error:', errorText)
        throw new Error(`Failed to create match: ${response.status}`)
      }

      const data = await response.json()
      
      if (data.status === 'queued') {
        alert(data.message || 'Added to matchmaking queue...')
        router.push('/play/multiplayer')
        return
      }
      
      if ((data.success && data.match) || (data.match && !data.hasOwnProperty('success'))) {
        router.push(`/game/${data.match.id}`)
      } else {
        throw new Error(data.error || data.message || 'Failed to create match')
      }
    } catch (error) {
      console.error('Error creating match:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to create match.'
      alert(errorMessage)
    } finally {
      setIsCreating(false)
      setSelectedType(null)
    }
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card variant="elevated" className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <Grid3X3 className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold mb-2">Sign In Required</h2>
              <p className="text-muted-foreground">Please sign in to create a match</p>
            </div>
            <Button onClick={() => router.push('/auth/signin')} className="w-full">
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const gameTypes = [
    {
      id: 'SINGLE_PLAYER',
      title: 'Solo Practice',
      description: 'Practice your Sudoku skills at your own pace with no time pressure.',
      icon: Bot,
      badge: 'Free',
      badgeVariant: 'success' as const,
      features: [
        { icon: Clock, text: 'No time limit' },
        { icon: Target, text: 'All difficulty levels' },
        { icon: Sparkles, text: 'Track your progress' },
      ],
      buttonText: 'Start Practice',
      buttonVariant: 'default' as const,
      entryFee: 0,
    },
    {
      id: 'MULTIPLAYER_FREE',
      title: 'Free Match',
      description: 'Challenge other players in real-time. First to solve wins!',
      icon: Users,
      badge: 'Free',
      badgeVariant: 'success' as const,
      features: [
        { icon: Clock, text: '30 min time limit' },
        { icon: Users, text: 'Real-time opponent' },
        { icon: Trophy, text: 'Earn ranking points' },
      ],
      buttonText: 'Find Match',
      buttonVariant: 'outline' as const,
      entryFee: 0,
    },
    {
      id: 'MULTIPLAYER_PAID',
      title: 'Prize Match',
      description: 'Compete for real money! Winner takes 80% of the prize pool.',
      icon: Trophy,
      badge: '₹50 Entry',
      badgeVariant: 'warning' as const,
      features: [
        { icon: Clock, text: '30 min time limit' },
        { icon: Wallet, text: '₹80 prize (2 players)' },
        { icon: Shield, text: 'Verified fair play' },
      ],
      buttonText: 'Join Match',
      buttonVariant: 'premium' as const,
      entryFee: 50,
    },
  ]

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
                  <Play className="w-5 h-5" />
                </div>
                <span className="text-lg font-semibold">New Game</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container-default py-8 space-y-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto animate-fade-in-up">
          <h1 className="text-heading text-3xl sm:text-4xl mb-4">
            Choose Your Game Mode
          </h1>
          <p className="text-foreground-secondary text-lg">
            Select how you want to play. Each mode offers a unique experience.
          </p>
        </div>

        {/* Game Type Cards */}
        <div className="grid md:grid-cols-3 gap-6 animate-fade-in-up stagger-1">
          {gameTypes.map((type) => (
            <Card 
              key={type.id} 
              variant={type.id === 'MULTIPLAYER_PAID' ? 'highlight' : 'interactive'}
              className="relative overflow-hidden"
            >
              <Badge 
                variant={type.badgeVariant} 
                className="absolute top-4 right-4"
              >
                {type.badge}
              </Badge>

              <CardHeader className="pb-4">
                <div className="flex items-center gap-4 mb-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                    type.id === 'MULTIPLAYER_PAID' 
                      ? 'bg-gradient-to-br from-primary to-primary-light text-primary-foreground' 
                      : 'bg-primary/10 text-primary'
                  }`}>
                    <type.icon className="w-6 h-6" />
                  </div>
                  <CardTitle className="text-xl">{type.title}</CardTitle>
                </div>
                <p className="text-sm text-muted-foreground">{type.description}</p>
              </CardHeader>

              <CardContent className="space-y-6">
                <ul className="space-y-3">
                  {type.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <feature.icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-foreground-secondary">{feature.text}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  onClick={() => createMatch(type.id as 'SINGLE_PLAYER' | 'MULTIPLAYER_FREE' | 'MULTIPLAYER_PAID', type.entryFee)}
                  disabled={isCreating}
                  loading={isCreating && selectedType === type.id}
                  variant={type.buttonVariant}
                  className="w-full"
                >
                  {type.buttonText}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* How It Works */}
        <Card className="animate-fade-in-up stagger-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-muted-foreground" />
              How It Works
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  title: 'Solo Practice',
                  description: 'Play against yourself with no time pressure. Perfect for learning strategies.',
                },
                {
                  title: 'Free Matches',
                  description: 'Get matched with real players instantly. First to solve the puzzle wins.',
                },
                {
                  title: 'Prize Matches',
                  description: 'Entry fees build the prize pool. Winners take 80% of the total.',
                },
              ].map((item, i) => (
                <div key={i} className="space-y-2">
                  <h4 className="font-semibold">{item.title}</h4>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
