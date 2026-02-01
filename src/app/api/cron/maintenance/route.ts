/**
 * Maintenance/Cron API
 * 
 * This endpoint should be called periodically (e.g., every minute via Vercel cron)
 * to perform maintenance tasks:
 * 
 * - Clean up expired queue entries
 * - End timed-out games
 * - Process pending refunds
 * 
 * Security: Protected by a secret key
 */

import { NextRequest, NextResponse } from 'next/server'
import { cleanupExpiredEntries } from '@/lib/matchmaking/queueService'
import { checkAndEndTimedOutGames } from '@/lib/game/gameEngine'
import { logger } from '@/lib/services/logger'

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      logger.warn('Unauthorized cron attempt')
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const startTime = Date.now()
    const results: Record<string, number> = {}

    // 1. Clean up expired queue entries
    try {
      results.expiredQueueEntries = await cleanupExpiredEntries()
    } catch (error) {
      logger.error('Queue cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      results.expiredQueueEntries = -1
    }

    // 2. End timed-out games
    try {
      results.timedOutGames = await checkAndEndTimedOutGames()
    } catch (error) {
      logger.error('Game timeout check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      results.timedOutGames = -1
    }

    const duration = Date.now() - startTime

    logger.info('Maintenance completed', {
      ...results,
      durationMs: duration,
    })

    return NextResponse.json({
      success: true,
      results,
      durationMs: duration,
    })
  } catch (error) {
    logger.error('Maintenance failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: 'Maintenance failed' },
      { status: 500 }
    )
  }
}

// Also allow GET for simple health checks
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
}
