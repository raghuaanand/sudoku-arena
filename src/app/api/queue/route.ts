/**
 * Matchmaking Queue API
 * 
 * Endpoints:
 * - POST /api/queue/join - Join the matchmaking queue
 * - POST /api/queue/leave - Leave the queue
 * - GET /api/queue/status - Get queue status
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { 
  joinQueue, 
  leaveQueue, 
  getQueueStatus,
  getQueueStats 
} from '@/lib/matchmaking/queueService'
import { Difficulty } from '@prisma/client'
import { logger } from '@/lib/services/logger'

// Join the matchmaking queue
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { entryFee, duration, difficulty, paymentOrderId } = body

    // Validate inputs
    if (typeof entryFee !== 'number' || entryFee < 0) {
      return NextResponse.json(
        { error: 'Invalid entry fee' },
        { status: 400 }
      )
    }

    if (!duration || ![300, 600, 900].includes(duration)) {
      return NextResponse.json(
        { error: 'Invalid duration. Must be 300, 600, or 900 seconds' },
        { status: 400 }
      )
    }

    const difficultyValue = (difficulty?.toUpperCase() as Difficulty) || Difficulty.MEDIUM
    if (!Object.values(Difficulty).includes(difficultyValue)) {
      return NextResponse.json(
        { error: 'Invalid difficulty' },
        { status: 400 }
      )
    }

    logger.info('Queue join request', {
      userId: session.user.id,
      entryFee,
      duration,
      difficulty: difficultyValue,
    })

    const result = await joinQueue({
      userId: session.user.id,
      entryFee,
      duration,
      difficulty: difficultyValue,
      paymentOrderId,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      queueId: result.queueId,
      position: result.position,
      matchId: result.matchId, // If immediately matched
    })
  } catch (error) {
    logger.error('Queue join failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'Failed to join queue' },
      { status: 500 }
    )
  }
}

// Get queue status
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const status = await getQueueStatus(session.user.id)
    const stats = await getQueueStats()

    return NextResponse.json({
      ...status,
      totalPlayersWaiting: stats.totalWaiting,
    })
  } catch (error) {
    logger.error('Queue status check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'Failed to get queue status' },
      { status: 500 }
    )
  }
}

// Leave the queue
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const result = await leaveQueue(session.user.id)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Queue leave failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'Failed to leave queue' },
      { status: 500 }
    )
  }
}
