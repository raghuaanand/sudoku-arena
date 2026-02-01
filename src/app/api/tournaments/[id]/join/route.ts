import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// POST /api/tournaments/[id]/join - Join tournament
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const params = await context.params
    const tournamentId = params.id

    // Check user's wallet balance
    const wallet = await prisma.wallet.findUnique({
      where: { userId: session.user.id }
    })

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
    }

    // For mock tournament, assume entry fee is 50
    const entryFee = 50
    
    if (wallet.balance < entryFee) {
      return NextResponse.json(
        { error: 'Insufficient wallet balance' },
        { status: 400 }
      )
    }

    // Deduct entry fee
    await prisma.wallet.update({
      where: { userId: session.user.id },
      data: { balance: { decrement: entryFee } }
    })

    // Create transaction record
    await prisma.transaction.create({
      data: {
        userId: session.user.id,
        type: 'ENTRY_FEE',
        amount: -entryFee,
        description: `Tournament entry fee for tournament ${tournamentId}`,
        status: 'COMPLETED',
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance - entryFee
      }
    })

    return NextResponse.json({
      message: 'Successfully joined tournament',
      tournamentId,
      entryFee,
      remainingBalance: wallet.balance - entryFee
    })

  } catch (error) {
    console.error('Error joining tournament:', error)
    return NextResponse.json(
      { error: 'Failed to join tournament' },
      { status: 500 }
    )
  }
}

// DELETE /api/tournaments/[id]/join - Leave tournament (if registration still open)
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const params = await context.params
    const tournamentId = params.id

    // Refund entry fee (for mock tournament)
    const entryFee = 50

    // Get current wallet balance
    const wallet = await prisma.wallet.findUnique({
      where: { userId: session.user.id }
    })
    const currentBalance = wallet?.balance || 0

    await prisma.wallet.upsert({
      where: { userId: session.user.id },
      update: { balance: { increment: entryFee } },
      create: { userId: session.user.id, balance: entryFee }
    })

    // Create refund transaction
    await prisma.transaction.create({
      data: {
        userId: session.user.id,
        type: 'REFUND',
        amount: entryFee,
        description: `Tournament entry refund for tournament ${tournamentId}`,
        status: 'COMPLETED',
        balanceBefore: currentBalance,
        balanceAfter: currentBalance + entryFee
      }
    })

    return NextResponse.json({
      message: 'Successfully left tournament',
      tournamentId,
      refundAmount: entryFee
    })

  } catch (error) {
    console.error('Error leaving tournament:', error)
    return NextResponse.json(
      { error: 'Failed to leave tournament' },
      { status: 500 }
    )
  }
}
