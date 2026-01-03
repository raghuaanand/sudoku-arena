'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Trophy, 
  Medal, 
  Star,
  TrendingUp,
  Award,
  Crown,
  Grid3X3,
  ChevronLeft,
  Users,
} from 'lucide-react'

interface UserRanking {
  id: string
  name: string
  email: string
  rank: number
  totalWins: number
  totalMatches: number
  winRate: number
  joinedAt: string
}

interface Achievement {
  id: string
  title: string
  description: string
  icon: string
  points: number
  unlocked: boolean
  unlockedAt?: string
}

export default function LeaderboardPage() {
  const { data: session } = useSession()
  const router = useRouter()
  
  const [rankings, setRankings] = useState<UserRanking[]>([])
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [currentUser, setCurrentUser] = useState<UserRanking | null>(null)
  const [activeTab, setActiveTab] = useState<'rankings' | 'achievements'>('rankings')
  const [period, setPeriod] = useState<'all' | 'week' | 'month'>('all')
  const [loading, setLoading] = useState(true)
  const [totalPoints, setTotalPoints] = useState(0)

  useEffect(() => {
    if (!session?.user?.id) {
      router.push('/auth/signin')
      return
    }
    
    fetchData()
  }, [session, router, period])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [rankingsRes, achievementsRes] = await Promise.all([
        fetch(`/api/rankings?period=${period}&limit=50`),
        fetch('/api/achievements')
      ])

      if (rankingsRes.ok) {
        const rankingsData = await rankingsRes.json()
        setRankings(rankingsData.rankings || [])
        setCurrentUser(rankingsData.currentUser || null)
      }

      if (achievementsRes.ok) {
        const achievementsData = await achievementsRes.json()
        setAchievements(achievementsData.achievements || [])
        setTotalPoints(achievementsData.totalPoints || 0)
      }
    } catch (error) {
      console.error('Error fetching leaderboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRankDisplay = (rank: number) => {
    if (rank === 1) return <Crown className="w-5 h-5 text-amber-500" />
    if (rank === 2) return <Medal className="w-5 h-5 text-gray-400" />
    if (rank === 3) return <Medal className="w-5 h-5 text-amber-700" />
    return <span className="text-sm font-semibold text-muted-foreground">#{rank}</span>
  }

  const getRankStyle = (rank: number) => {
    if (rank === 1) return 'bg-gradient-to-r from-amber-500/20 to-amber-500/10 border-amber-500/30'
    if (rank === 2) return 'bg-gradient-to-r from-gray-400/20 to-gray-400/10 border-gray-400/30'
    if (rank === 3) return 'bg-gradient-to-r from-amber-700/20 to-amber-700/10 border-amber-700/30'
    return 'border-border hover:bg-muted/30'
  }

  if (!session?.user?.id) return null

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-muted border-t-primary animate-spin mx-auto" />
          <p className="text-muted-foreground">Loading leaderboard...</p>
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
                <span className="text-lg font-semibold">Leaderboard</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container-default py-8 space-y-8">
        {/* Tab Navigation */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center animate-fade-in-up">
          <div className="flex gap-2">
            <Button
              variant={activeTab === 'rankings' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('rankings')}
            >
              <Trophy className="w-4 h-4" />
              Rankings
            </Button>
            <Button
              variant={activeTab === 'achievements' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('achievements')}
            >
              <Award className="w-4 h-4" />
              Achievements
            </Button>
          </div>

          {activeTab === 'rankings' && (
            <div className="flex gap-2">
              {[
                { key: 'all', label: 'All Time' },
                { key: 'month', label: 'Monthly' },
                { key: 'week', label: 'Weekly' },
              ].map(({ key, label }) => (
                <Button
                  key={key}
                  variant={period === key ? 'soft' : 'ghost'}
                  size="sm"
                  onClick={() => setPeriod(key as typeof period)}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {activeTab === 'rankings' && (
          <div className="space-y-6">
            {/* Current User Card */}
            {currentUser && (
              <Card variant="highlight" className="animate-fade-in-up stagger-1">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg">
                        {currentUser.name[0]}
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">{currentUser.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {currentUser.totalWins} wins • {currentUser.winRate}% win rate
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-primary">#{currentUser.rank}</div>
                      <p className="text-sm text-muted-foreground">{currentUser.totalMatches} matches</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Rankings List */}
            <Card className="animate-fade-in-up stagger-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-muted-foreground" />
                  Top Players
                </CardTitle>
                <CardDescription>
                  {period === 'all' ? 'All-time' : period === 'month' ? 'This month' : 'This week'} rankings
                </CardDescription>
              </CardHeader>
              <CardContent>
                {rankings.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                      <Trophy className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold mb-2">No rankings yet</h3>
                    <p className="text-sm text-muted-foreground">
                      Start playing to appear on the leaderboard
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {rankings.map((user) => (
                      <div
                        key={user.id}
                        className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${getRankStyle(user.rank)} ${
                          user.id === session?.user?.id ? 'ring-2 ring-primary/20' : ''
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 flex items-center justify-center">
                            {getRankDisplay(user.rank)}
                          </div>
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-semibold">
                            {user.name[0]}
                          </div>
                          <div>
                            <h4 className="font-medium">{user.name}</h4>
                            <p className="text-xs text-muted-foreground">
                              Joined {new Date(user.joinedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{user.totalWins} wins</p>
                          <p className="text-xs text-muted-foreground">
                            {user.winRate}% • {user.totalMatches} games
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'achievements' && (
          <div className="space-y-6">
            {/* Achievement Stats */}
            <div className="grid sm:grid-cols-3 gap-4 animate-fade-in-up stagger-1">
              <Card className="p-6 text-center">
                <Award className="w-8 h-8 text-primary mx-auto mb-3" />
                <div className="text-2xl font-bold">{achievements.filter(a => a.unlocked).length}</div>
                <p className="text-sm text-muted-foreground">Unlocked</p>
              </Card>
              <Card className="p-6 text-center">
                <Star className="w-8 h-8 text-amber-500 mx-auto mb-3" />
                <div className="text-2xl font-bold">{totalPoints}</div>
                <p className="text-sm text-muted-foreground">Total Points</p>
              </Card>
              <Card className="p-6 text-center">
                <TrendingUp className="w-8 h-8 text-success mx-auto mb-3" />
                <div className="text-2xl font-bold">
                  {achievements.length > 0 ? Math.round((achievements.filter(a => a.unlocked).length / achievements.length) * 100) : 0}%
                </div>
                <p className="text-sm text-muted-foreground">Completion</p>
              </Card>
            </div>

            {/* Achievements Grid */}
            <Card className="animate-fade-in-up stagger-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-muted-foreground" />
                  Achievements
                </CardTitle>
                <CardDescription>
                  Complete challenges and earn rewards
                </CardDescription>
              </CardHeader>
              <CardContent>
                {achievements.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                      <Award className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold mb-2">No achievements yet</h3>
                    <p className="text-sm text-muted-foreground">
                      Start playing to unlock achievements
                    </p>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {achievements.map((achievement) => (
                      <Card
                        key={achievement.id}
                        className={`p-4 ${
                          achievement.unlocked 
                            ? 'border-success/30 bg-success/5' 
                            : 'opacity-60'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <span className="text-2xl">{achievement.icon}</span>
                          {achievement.unlocked && (
                            <Badge variant="success" size="sm">Unlocked</Badge>
                          )}
                        </div>
                        <h4 className="font-semibold mb-1">{achievement.title}</h4>
                        <p className="text-sm text-muted-foreground mb-3">{achievement.description}</p>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-primary font-medium">{achievement.points} pts</span>
                          {achievement.unlocked && achievement.unlockedAt && (
                            <span className="text-muted-foreground">
                              {new Date(achievement.unlockedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
