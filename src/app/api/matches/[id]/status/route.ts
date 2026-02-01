import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: matchId } = await params

    // Get match from database
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        player1: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        player2: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    })

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }

    // Check if user is participant
    const isParticipant = match.player1.id === session.user.id || 
                         (match.player2 && match.player2.id === session.user.id)

    if (!isParticipant) {
      return NextResponse.json({ error: 'Not authorized to view this match' }, { status: 403 })
    }

    // Create players array for compatibility
    const players = [match.player1]
    if (match.player2) {
      players.push(match.player2)
    }

    // Basic match status response
    const matchStatus = {
      id: match.id,
      status: match.status,
      type: match.type,
      entryFee: match.entryFee,
      prizePool: match.prizePool,
      startedAt: match.startedAt,
      endedAt: match.endedAt,
      winnerId: match.winnerId,
      totalPlayers: players.length,
      players: players.map(player => ({
        id: player.id,
        name: player.name,
        email: player.email
      })),
      game: {
        grid: match.sudokuGrid ? JSON.parse(match.sudokuGrid) : null,
        solution: match.solution ? JSON.parse(match.solution) : null
      }
    }

    return NextResponse.json(matchStatus)

  } catch (error) {
    console.error('Error getting match status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { action, data } = await request.json()
    const {id: matchId} = await params

    // Get match from database
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        player1: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        player2: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    })

    if (!match) {
      return NextResponse.json({ error: 'Match not found' }, { status: 404 })
    }

    // Check if user is participant
    const isParticipant = match.player1.id === session.user.id || 
                         (match.player2 && match.player2.id === session.user.id)

    if (!isParticipant) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    switch (action) {
      case 'make_move':
        // Update the grid with the new move
        await prisma.match.update({
          where: { id: matchId },
          data: {
            sudokuGrid: JSON.stringify(data.grid),
            updatedAt: new Date()
          }
        })
        break

      case 'complete_game':
        // Mark the match as completed
        await prisma.match.update({
          where: { id: matchId },
          data: {
            status: 'FINISHED',
            winnerId: session.user.id,
            endedAt: new Date()
          }
        })

        // Award prize if applicable
        if (match.prizePool > 0) {
          // Get current wallet balance
          const wallet = await prisma.wallet.findUnique({ where: { userId: session.user.id } })
          const currentBalance = wallet?.balance || 0

          await prisma.wallet.upsert({
            where: { userId: session.user.id },
            update: {
              balance: { increment: match.prizePool }
            },
            create: {
              userId: session.user.id,
              balance: match.prizePool
            }
          })

          // Create transaction record
          await prisma.transaction.create({
            data: {
              userId: session.user.id,
              amount: match.prizePool,
              type: 'MATCH_WIN',
              description: `Prize won for match ${matchId}`,
              status: 'COMPLETED',
              balanceBefore: currentBalance,
              balanceAfter: currentBalance + match.prizePool
            }
          })
        }
        break

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error updating match status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
