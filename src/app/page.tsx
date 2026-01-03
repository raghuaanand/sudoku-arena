'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SudokuGridComponent } from '@/components/sudoku/SudokuGrid';
import { generatePuzzle } from '@/utils/sudoku';
import {
  Trophy,
  Users,
  Bot,
  Play,
  Crown,
  Timer,
  ArrowRight,
  Sparkles,
  Shield,
  Zap,
  Target,
  ChevronRight,
  Grid3X3,
  TrendingUp,
  Award,
  Wallet,
} from 'lucide-react';

export default function Home() {
  const [demoGrid] = useState(() => generatePuzzle('medium').puzzle);
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <header className="nav-header">
        <div className="container-default">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary text-primary-foreground">
                <Grid3X3 className="w-5 h-5" />
              </div>
              <span className="text-lg font-semibold tracking-tight">Sudoku Arena</span>
            </div>
            
            <nav className="hidden md:flex items-center gap-1">
              <Link href="/leaderboard" className="nav-link">
                Leaderboard
              </Link>
              <Link href="/tournaments" className="nav-link">
                Tournaments
              </Link>
            </nav>

            <div className="flex items-center gap-3">
              {session ? (
                <Link href="/dashboard">
                  <Button size="sm">
                    Dashboard
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link href="/auth/signin">
                    <Button variant="ghost" size="sm">Sign In</Button>
                  </Link>
                  <Link href="/auth/signup">
                    <Button size="sm">Get Started</Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="section-padding relative overflow-hidden">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        </div>

        <div className="container-default">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left Content */}
            <div className={`space-y-8 ${mounted ? 'animate-fade-in-up' : 'opacity-0'}`}>
              <Badge variant="default" size="lg">
                <Sparkles className="w-3.5 h-3.5" />
                The Premier Sudoku Platform
              </Badge>

              <div className="space-y-4">
                <h1 className="text-display text-4xl sm:text-5xl lg:text-6xl text-foreground">
                  Master the Art of
                  <span className="block gradient-text">Sudoku</span>
                </h1>
                <p className="text-lg text-foreground-secondary max-w-lg leading-relaxed">
                  Compete against players worldwide, challenge intelligent AI, and climb the ranks in professional tournaments. Your journey to becoming a Sudoku master starts here.
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                {session ? (
                  <Link href="/dashboard">
                    <Button size="lg" variant="premium">
                      <Play className="w-5 h-5" />
                      Enter Arena
                    </Button>
                  </Link>
                ) : (
                  <Link href="/auth/signup">
                    <Button size="lg" variant="premium">
                      <Play className="w-5 h-5" />
                      Start Playing Free
                    </Button>
                  </Link>
                )}
                <Link href="/leaderboard">
                  <Button size="lg" variant="outline">
                    View Leaderboard
                  </Button>
                </Link>
              </div>

              {/* Social Proof */}
              <div className="flex items-center gap-8 pt-4">
                <div>
                  <div className="text-2xl font-bold text-foreground">50K+</div>
                  <div className="text-sm text-muted-foreground">Active Players</div>
                </div>
                <div className="divider-vertical h-10" />
                <div>
                  <div className="text-2xl font-bold text-foreground">1M+</div>
                  <div className="text-sm text-muted-foreground">Games Played</div>
                </div>
                <div className="divider-vertical h-10" />
                <div>
                  <div className="text-2xl font-bold text-foreground">₹5M+</div>
                  <div className="text-sm text-muted-foreground">Prizes Won</div>
                </div>
              </div>
            </div>

            {/* Right Content - Demo Grid */}
            <div className={`flex justify-center lg:justify-end ${mounted ? 'animate-fade-in stagger-2' : 'opacity-0'}`}>
              <div className="relative">
                {/* Glow effect */}
                <div className="absolute -inset-4 bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 rounded-3xl blur-2xl opacity-60" />
                
                <Card variant="glass" className="relative p-6 sm:p-8">
                  <div className="absolute top-4 right-4">
                    <Badge variant="live">Live Demo</Badge>
                  </div>

                  <SudokuGridComponent
                    grid={demoGrid}
                    isReadonly={true}
                    className="w-[280px] sm:w-[320px]"
                  />

                  <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
                    <span className="text-sm text-muted-foreground">Medium Difficulty</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`w-2 h-2 rounded-full ${
                            i <= 3 ? 'bg-primary' : 'bg-muted'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Game Modes Section */}
      <section className="section-padding bg-muted/30">
        <div className="container-default">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge variant="muted" size="lg" className="mb-4">Game Modes</Badge>
            <h2 className="text-heading text-3xl sm:text-4xl mb-4">
              Choose Your Challenge
            </h2>
            <p className="text-foreground-secondary text-lg">
              From casual practice to high-stakes tournaments, find the perfect way to test your skills.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {/* Training Mode */}
            <Card variant="interactive" className="p-6 group">
              <div className="flex items-center gap-4 mb-6">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Training Mode</h3>
                  <p className="text-sm text-muted-foreground">Practice vs AI</p>
                </div>
              </div>

              <p className="text-foreground-secondary mb-6">
                Sharpen your skills against intelligent AI opponents. Perfect for learning strategies and improving your game.
              </p>

              <ul className="space-y-3 mb-8">
                {[
                  { icon: Target, text: '5 difficulty levels' },
                  { icon: Timer, text: 'No time pressure' },
                  { icon: Award, text: 'Track your progress' },
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-foreground-secondary">
                    <item.icon className="w-4 h-4 text-primary" />
                    {item.text}
                  </li>
                ))}
              </ul>

              <Link href={session ? '/create-match' : '/auth/signin'} className="block">
                <Button variant="soft" className="w-full">
                  Start Training
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </Card>

            {/* Multiplayer Mode */}
            <Card variant="interactive" className="p-6 group">
              <div className="flex items-center gap-4 mb-6">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">PvP Matches</h3>
                  <p className="text-sm text-muted-foreground">Real-time battles</p>
                </div>
              </div>

              <p className="text-foreground-secondary mb-6">
                Challenge players from around the world in intense real-time matches. Prove you're the fastest solver.
              </p>

              <ul className="space-y-3 mb-8">
                {[
                  { icon: Zap, text: 'Instant matchmaking' },
                  { icon: TrendingUp, text: 'Ranked matches' },
                  { icon: Trophy, text: 'Global leaderboard' },
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-foreground-secondary">
                    <item.icon className="w-4 h-4 text-accent" />
                    {item.text}
                  </li>
                ))}
              </ul>

              <Link href={session ? '/create-match' : '/auth/signin'} className="block">
                <Button variant="outline" className="w-full">
                  Find Match
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </Card>

            {/* Tournaments */}
            <Card variant="highlight" className="p-6 group">
              <Badge className="absolute top-4 right-4">Premium</Badge>
              
              <div className="flex items-center gap-4 mb-6">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary-light text-primary-foreground">
                  <Crown className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Tournaments</h3>
                  <p className="text-sm text-muted-foreground">Win real prizes</p>
                </div>
              </div>

              <p className="text-foreground-secondary mb-6">
                Compete in professional bracket tournaments for real cash prizes. Entry fees create the prize pool.
              </p>

              <ul className="space-y-3 mb-8">
                {[
                  { icon: Wallet, text: 'Cash prizes up to ₹10,000' },
                  { icon: Shield, text: 'Verified fair play' },
                  { icon: Sparkles, text: 'Daily tournaments' },
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-foreground-secondary">
                    <item.icon className="w-4 h-4 text-primary" />
                    {item.text}
                  </li>
                ))}
              </ul>

              <Link href={session ? '/tournaments' : '/auth/signin'} className="block">
                <Button variant="premium" className="w-full">
                  Browse Tournaments
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </Card>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="section-padding">
        <div className="container-default">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge variant="muted" size="lg" className="mb-4">Why Sudoku Arena</Badge>
            <h2 className="text-heading text-3xl sm:text-4xl mb-4">
              Built for Competitive Gaming
            </h2>
            <p className="text-foreground-secondary text-lg">
              Experience the most refined Sudoku platform, designed with precision for serious players.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Zap,
                title: 'Lightning Fast',
                description: 'Real-time gameplay with millisecond precision for competitive matches.',
              },
              {
                icon: Target,
                title: 'Smart Matching',
                description: 'Advanced algorithms ensure fair matches based on skill level.',
              },
              {
                icon: Shield,
                title: 'Secure Payments',
                description: 'Bank-grade security for all transactions with instant processing.',
              },
              {
                icon: Trophy,
                title: 'Fair Play',
                description: 'Anti-cheat systems ensure every victory is earned honestly.',
              },
            ].map((feature, i) => (
              <Card key={i} variant="default" className="p-6 text-center">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-muted mx-auto mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="section-padding relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-accent/5" />
        </div>

        <div className="container-default">
          <Card variant="glass" className="p-8 sm:p-12 text-center max-w-3xl mx-auto">
            <Badge variant="default" size="lg" className="mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              Join the Community
            </Badge>

            <h2 className="text-heading text-3xl sm:text-4xl mb-4">
              Ready to Begin?
            </h2>
            <p className="text-foreground-secondary text-lg mb-8 max-w-xl mx-auto">
              Join thousands of players competing daily. Create your free account and start your journey to becoming a Sudoku champion.
            </p>

            <div className="flex flex-wrap justify-center gap-4">
              {session ? (
                <Link href="/dashboard">
                  <Button size="xl" variant="premium">
                    <Play className="w-5 h-5" />
                    Go to Dashboard
                  </Button>
                </Link>
              ) : (
                <>
                  <Link href="/auth/signup">
                    <Button size="xl" variant="premium">
                      <Play className="w-5 h-5" />
                      Create Free Account
                    </Button>
                  </Link>
                  <Link href="/auth/signin">
                    <Button size="xl" variant="outline">
                      Sign In
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="container-default">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground">
                <Grid3X3 className="w-4 h-4" />
              </div>
              <span className="font-semibold">Sudoku Arena</span>
            </div>

            <nav className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
              <Link href="/leaderboard" className="hover:text-foreground transition-colors">Leaderboard</Link>
              <Link href="/tournaments" className="hover:text-foreground transition-colors">Tournaments</Link>
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            </nav>

            <p className="text-sm text-muted-foreground">
              © 2024 Sudoku Arena. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
