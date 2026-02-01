/**
 * Audit logging service for tracking all money movements and critical actions
 * 
 * This is essential for:
 * - Financial compliance and reconciliation
 * - Debugging payment/escrow issues
 * - Security incident investigation
 * - User support inquiries
 */

import { prisma } from '@/lib/prisma'
import { AuditAction as PrismaAuditAction, Prisma } from '@prisma/client'
import { logger } from './logger'

// Re-export the Prisma enum for convenience
export { AuditAction } from '@prisma/client'
export type { AuditAction as AuditActionType } from '@prisma/client'

export interface AuditLogParams {
  userId?: string | null
  action: PrismaAuditAction
  entityType: string
  entityId: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

/**
 * Create an audit log entry
 * This is intentionally fire-and-forget to not block operations
 */
export async function auditLog(params: AuditLogParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId || undefined,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        before: (params.before as Prisma.JsonObject) || undefined,
        after: (params.after as Prisma.JsonObject) || undefined,
        metadata: (params.metadata as Prisma.JsonObject) || undefined,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    })

    logger.debug('Audit log created', {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
    })
  } catch (error) {
    // Don't throw - audit logging should not break main flow
    logger.error('Failed to create audit log', {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Query audit logs for an entity
 */
export async function getAuditLogs(
  entityType: string,
  entityId: string,
  limit = 50
) {
  return prisma.auditLog.findMany({
    where: {
      entityType,
      entityId,
    },
    orderBy: {
      timestamp: 'desc',
    },
    take: limit,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  })
}

/**
 * Query audit logs for a user
 */
export async function getUserAuditLogs(userId: string, limit = 100) {
  return prisma.auditLog.findMany({
    where: {
      userId,
    },
    orderBy: {
      timestamp: 'desc',
    },
    take: limit,
  })
}

/**
 * Query audit logs by action type within a time range
 */
export async function getAuditLogsByAction(
  action: PrismaAuditAction,
  startDate: Date,
  endDate: Date,
  limit = 1000
) {
  return prisma.auditLog.findMany({
    where: {
      action,
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      timestamp: 'desc',
    },
    take: limit,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  })
}

/**
 * Create a batch audit log helper for transactions
 */
export function createBatchAuditLogger() {
  const entries: AuditLogParams[] = []

  return {
    add(params: AuditLogParams) {
      entries.push(params)
    },

    async flush() {
      if (entries.length === 0) return

      try {
        await prisma.auditLog.createMany({
          data: entries.map((e) => ({
            userId: e.userId || undefined,
            action: e.action,
            entityType: e.entityType,
            entityId: e.entityId,
            before: (e.before as Prisma.JsonObject) || undefined,
            after: (e.after as Prisma.JsonObject) || undefined,
            metadata: (e.metadata as Prisma.JsonObject) || undefined,
            ipAddress: e.ipAddress,
            userAgent: e.userAgent,
          })),
        })
      } catch (error) {
        logger.error('Failed to flush batch audit logs', {
          count: entries.length,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
  }
}
