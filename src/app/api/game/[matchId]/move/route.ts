/**
 * Game Move API
 * 
 * Server-authoritative move processing endpoint
 * Used as fallback when WebSocket is unavailable
 * 
 * POST /api/game/[matchId]/move
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { processMove, getGameState, getRemainingTime } from '@/lib/game/gameEngine'
import { logger } from '@/lib/services/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: { matchId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { matchId } = params
    const body = await request.json()
    const { row, col, value, clientTimestamp } = body

    // Validate inputs
    if (typeof row !== 'number' || row < 0 || row > 8) {
      return NextResponse.json(
        { error: 'Invalid row' },
        { status: 400 }
      )
    }

    if (typeof col !== 'number' || col < 0 || col > 8) {
      return NextResponse.json(
        { error: 'Invalid column' },
        { status: 400 }
      )
    }

    if (typeof value !== 'number' || value < 0 || value > 9) {
      return NextResponse.json(
        { error: 'Invalid value' },
        { status: 400 }
      )
    }

    // Process the move
    const result = await processMove(
      matchId,
      session.user.id,
      row,
      col,
      value,
      clientTimestamp
    )

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      )
    }

    // Get remaining time
    const timeRemaining = await getRemainingTime(matchId)

    return NextResponse.json({
      success: true,
      isCorrect: result.isCorrect,
      score: result.newScore,
      isGameOver: result.isGameOver,
      winnerId: result.winnerId,
      timeRemaining,
    })
  } catch (error) {
    logger.error('Move processing failed', {
      matchId: params.matchId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'Failed to process move' },
      { status: 500 }
    )
  }
}

// Get current game state
export async function GET(
  request: NextRequest,
  { params }: { params: { matchId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { matchId } = params
    const gameState = await getGameState(matchId)

    if (!gameState) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      )
    }

    // Only return data relevant to this player
    const isPlayer1 = session.user.id === gameState.player1.userId
    const isPlayer2 = session.user.id === gameState.player2?.userId

    if (!isPlayer1 && !isPlayer2) {
      return NextResponse.json(
        { error: 'Not a participant in this game' },
        { status: 403 }
      )
    }

    const myPlayer = isPlayer1 ? gameState.player1 : gameState.player2!
    const opponent = isPlayer1 ? gameState.player2 : gameState.player1

    const timeRemaining = gameState.endsAt 
      ? Math.max(0, Math.floor((gameState.endsAt - Date.now()) / 1000))
      : gameState.duration

    return NextResponse.json({
      matchId: gameState.matchId,
      status: gameState.status,
      puzzle: gameState.puzzle,
      myGrid: myPlayer.grid,
      myScore: myPlayer.correctCount,
      opponentScore: opponent?.correctCount || 0,
      opponentName: opponent?.name || 'Opponent',
      timeRemaining,
      duration: gameState.duration,
      isGameOver: gameState.status === 'FINISHED',
      winnerId: gameState.winnerId,
    })
  } catch (error) {
    logger.error('Get game state failed', {
      matchId: params.matchId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'Failed to get game state' },
      { status: 500 }
    )
  }
}
