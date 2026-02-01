/**
 * Redis Client for Real-time State Management
 * 
 * Used for:
 * - Matchmaking queue (FIFO with atomic operations)
 * - Game state caching
 * - Pub/Sub for real-time events
 * - Session management
 * 
 * Design considerations for Vercel:
 * - Connection pooling for serverless
 * - Graceful reconnection
 * - TTL on all keys to prevent memory leaks
 */

import { logger } from '@/lib/services/logger'

// Redis-compatible interface for both real Redis and in-memory fallback
export interface RedisClient {
  // Key-Value
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { ex?: number }): Promise<void>
  del(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  expire(key: string, seconds: number): Promise<void>
  incr(key: string): Promise<number>
  
  // Lists (for FIFO queue)
  lpush(key: string, value: string): Promise<number>
  rpop(key: string): Promise<string | null>
  lrange(key: string, start: number, stop: number): Promise<string[]>
  lrem(key: string, count: number, value: string): Promise<number>
  llen(key: string): Promise<number>
  
  // Sets (for player tracking)
  sadd(key: string, member: string): Promise<number>
  srem(key: string, member: string): Promise<number>
  smembers(key: string): Promise<string[]>
  sismember(key: string, member: string): Promise<boolean>
  
  // Hash (for game state)
  hset(key: string, field: string, value: string): Promise<void>
  hget(key: string, field: string): Promise<string | null>
  hgetall(key: string): Promise<Record<string, string>>
  hdel(key: string, field: string): Promise<void>
  
  // Pub/Sub
  publish(channel: string, message: string): Promise<void>
  subscribe(channel: string, callback: (message: string) => void): Promise<void>
  unsubscribe(channel: string): Promise<void>
  
  // Transactions (for atomic operations)
  multi(): RedisTransaction
}

export interface RedisTransaction {
  lpush(key: string, value: string): RedisTransaction
  rpop(key: string): RedisTransaction
  set(key: string, value: string): RedisTransaction
  del(key: string): RedisTransaction
  exec(): Promise<unknown[]>
}

// In-memory fallback for development/testing
class InMemoryRedis implements RedisClient {
  private store = new Map<string, string>()
  private lists = new Map<string, string[]>()
  private sets = new Map<string, Set<string>>()
  private hashes = new Map<string, Map<string, string>>()
  private subscribers = new Map<string, ((message: string) => void)[]>()
  private expiry = new Map<string, NodeJS.Timeout>()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null
  }

  async set(key: string, value: string, options?: { ex?: number }): Promise<void> {
    this.store.set(key, value)
    if (options?.ex) {
      this.setExpiry(key, options.ex)
    }
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
    this.lists.delete(key)
    this.sets.delete(key)
    this.hashes.delete(key)
    this.clearExpiry(key)
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key) || this.lists.has(key) || 
           this.sets.has(key) || this.hashes.has(key)
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.setExpiry(key, seconds)
  }

  async incr(key: string): Promise<number> {
    const current = parseInt(this.store.get(key) || '0', 10)
    const next = current + 1
    this.store.set(key, next.toString())
    return next
  }

  async lpush(key: string, value: string): Promise<number> {
    if (!this.lists.has(key)) {
      this.lists.set(key, [])
    }
    this.lists.get(key)!.unshift(value)
    return this.lists.get(key)!.length
  }

  async rpop(key: string): Promise<string | null> {
    const list = this.lists.get(key)
    return list?.pop() || null
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) || []
    const end = stop === -1 ? list.length : stop + 1
    return list.slice(start, end)
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    const list = this.lists.get(key)
    if (!list) return 0
    
    let removed = 0
    const newList = list.filter(item => {
      if (item === value && (count === 0 || removed < Math.abs(count))) {
        removed++
        return false
      }
      return true
    })
    this.lists.set(key, newList)
    return removed
  }

  async llen(key: string): Promise<number> {
    return this.lists.get(key)?.length || 0
  }

  async sadd(key: string, member: string): Promise<number> {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set())
    }
    const set = this.sets.get(key)!
    const sizeBefore = set.size
    set.add(member)
    return set.size - sizeBefore
  }

  async srem(key: string, member: string): Promise<number> {
    const set = this.sets.get(key)
    return set?.delete(member) ? 1 : 0
  }

  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) || [])
  }

  async sismember(key: string, member: string): Promise<boolean> {
    return this.sets.get(key)?.has(member) || false
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map())
    }
    this.hashes.get(key)!.set(field, value)
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) || null
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key)
    if (!hash) return {}
    return Object.fromEntries(hash)
  }

  async hdel(key: string, field: string): Promise<void> {
    this.hashes.get(key)?.delete(field)
  }

  async publish(channel: string, message: string): Promise<void> {
    const subs = this.subscribers.get(channel) || []
    subs.forEach(callback => callback(message))
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, [])
    }
    this.subscribers.get(channel)!.push(callback)
  }

  async unsubscribe(channel: string): Promise<void> {
    this.subscribers.delete(channel)
  }

  multi(): RedisTransaction {
    return new InMemoryTransaction(this)
  }

  private setExpiry(key: string, seconds: number): void {
    this.clearExpiry(key)
    const timeout = setTimeout(() => {
      this.del(key)
    }, seconds * 1000)
    this.expiry.set(key, timeout)
  }

  private clearExpiry(key: string): void {
    const timeout = this.expiry.get(key)
    if (timeout) {
      clearTimeout(timeout)
      this.expiry.delete(key)
    }
  }
}

class InMemoryTransaction implements RedisTransaction {
  private operations: (() => Promise<unknown>)[] = []

  constructor(private redis: InMemoryRedis) {}

  lpush(key: string, value: string): RedisTransaction {
    this.operations.push(() => this.redis.lpush(key, value))
    return this
  }

  rpop(key: string): RedisTransaction {
    this.operations.push(() => this.redis.rpop(key))
    return this
  }

  set(key: string, value: string): RedisTransaction {
    this.operations.push(() => this.redis.set(key, value))
    return this
  }

  del(key: string): RedisTransaction {
    this.operations.push(() => this.redis.del(key))
    return this
  }

  async exec(): Promise<unknown[]> {
    return Promise.all(this.operations.map(op => op()))
  }
}

// Singleton instance
let redisClient: RedisClient | null = null

/**
 * Get Redis client - uses real Redis if configured, otherwise in-memory
 */
export function getRedisClient(): RedisClient {
  if (redisClient) {
    return redisClient
  }

  const redisUrl = process.env.REDIS_URL

  if (redisUrl) {
    // In production, we'd use ioredis or @upstash/redis
    // For now, we'll use in-memory with a warning
    logger.warn('Redis URL configured but using in-memory fallback. Install ioredis for production.')
    redisClient = new InMemoryRedis()
  } else {
    logger.info('Using in-memory Redis (development mode)')
    redisClient = new InMemoryRedis()
  }

  return redisClient
}

// Key prefixes for organization
export const REDIS_KEYS = {
  // Matchmaking queue: queue:{entryFee}:{duration}
  matchmakingQueue: (entryFee: number, duration: number) => 
    `queue:${entryFee}:${duration}`,
  
  // User's queue status: user:queue:{userId}
  userQueueStatus: (userId: string) => 
    `user:queue:${userId}`,
  
  // Game state: game:{matchId}
  gameState: (matchId: string) => 
    `game:${matchId}`,
  
  // Player's current game: player:game:{userId}
  playerGame: (userId: string) => 
    `player:game:${userId}`,
  
  // Active players in game: game:players:{matchId}
  gamePlayers: (matchId: string) => 
    `game:players:${matchId}`,
  
  // Game events channel: events:{matchId}
  gameEvents: (matchId: string) => 
    `events:${matchId}`,
  
  // Player connection status: player:conn:{userId}
  playerConnection: (userId: string) => 
    `player:conn:${userId}`,
  
  // Rate limiting: ratelimit:{userId}:{action}
  rateLimit: (userId: string, action: string) => 
    `ratelimit:${userId}:${action}`,
}

// TTL values (in seconds)
export const REDIS_TTL = {
  queueEntry: 300,      // 5 minutes
  gameState: 7200,      // 2 hours
  playerConnection: 60, // 1 minute (heartbeat)
  rateLimit: 60,        // 1 minute
}
