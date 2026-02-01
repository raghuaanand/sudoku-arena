/**
 * Structured logging service for production observability
 * 
 * Features:
 * - Structured JSON output for log aggregation
 * - Log levels: debug, info, warn, error
 * - Request context tracking
 * - Performance metrics
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
}

class Logger {
  private minLevel: LogLevel

  constructor() {
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.minLevel)
  }

  private formatEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    }

    if (context && Object.keys(context).length > 0) {
      entry.context = context
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }

    return entry
  }

  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): void {
    if (!this.shouldLog(level)) return

    const entry = this.formatEntry(level, message, context, error)

    // In production, output JSON for log aggregation
    // In development, use console methods for better readability
    if (process.env.NODE_ENV === 'production') {
      const output = JSON.stringify(entry)
      switch (level) {
        case 'error':
          console.error(output)
          break
        case 'warn':
          console.warn(output)
          break
        default:
          console.log(output)
      }
    } else {
      // Development: human-readable output
      const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`
      const contextStr = context ? ` ${JSON.stringify(context)}` : ''

      switch (level) {
        case 'error':
          console.error(`${prefix} ${message}${contextStr}`, error || '')
          break
        case 'warn':
          console.warn(`${prefix} ${message}${contextStr}`)
          break
        case 'debug':
          console.debug(`${prefix} ${message}${contextStr}`)
          break
        default:
          console.log(`${prefix} ${message}${contextStr}`)
      }
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context)
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context)
  }

  error(message: string, context?: LogContext, error?: Error): void {
    this.log('error', message, context, error)
  }

  // Utility for timing operations
  time(label: string): () => void {
    const start = performance.now()
    return () => {
      const duration = performance.now() - start
      this.info(`${label} completed`, { durationMs: Math.round(duration) })
    }
  }
}

// Singleton instance
export const logger = new Logger()

// Request context for tracing
export interface RequestContext {
  requestId?: string
  userId?: string
  path?: string
  method?: string
}

let currentContext: RequestContext = {}

export function setRequestContext(context: RequestContext): void {
  currentContext = context
}

export function getRequestContext(): RequestContext {
  return currentContext
}

export function clearRequestContext(): void {
  currentContext = {}
}

// Middleware-style logging for API routes
export function logRequest(
  method: string,
  path: string,
  context?: LogContext
): void {
  logger.info('API Request', {
    method,
    path,
    ...currentContext,
    ...context,
  })
}

export function logResponse(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): void {
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info'
  logger[level]('API Response', {
    method,
    path,
    statusCode,
    durationMs,
    ...currentContext,
  })
}
