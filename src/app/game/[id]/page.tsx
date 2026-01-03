'use client'

import { GameRoom } from '@/components/GameRoom'
import { SocketProvider } from '@/contexts/SocketContext'

interface GamePageProps {
  params: {
    id: string
  }
}

export default function GamePage({ params }: GamePageProps) {
  const { id } = params
  
  return (
    <div className="min-h-screen bg-background relative">
      {/* Subtle gradient background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10">
        <SocketProvider>
          <GameRoom matchId={id} />
        </SocketProvider>
      </div>
    </div>
  )
}
