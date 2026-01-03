// Socket.IO connection utilities for different environments
import { io, Socket } from 'socket.io-client'

export interface SocketConfig {
  url: string
  path: string
  transports: ('websocket' | 'polling')[]
}

export function getSocketConfig(): SocketConfig {
  if (typeof window === 'undefined') {
    // Server-side
    return {
      url: 'http://localhost:3003',
      path: '/socket.io/',
      transports: ['polling', 'websocket']
    }
  }

  if (process.env.NODE_ENV === 'development') {
    // Local development
    return {
      url: process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3003',
      path: '/socket.io/',
      transports: ['websocket', 'polling']
    }
  }

  // Production - fallback to polling for better compatibility
  return {
    url: window.location.origin,
    path: '/api/socket/io/',
    transports: ['polling'] // Use polling for Vercel compatibility
  }
}

export function createSocketConnection(): Socket {
  const config = getSocketConfig()
  
  console.log('Creating socket connection with config:', config)
  
  return io(config.url, {
    path: config.path,
    transports: config.transports,
    autoConnect: true,
    forceNew: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    upgrade: true
  })
}

// Polyfill for environments without native WebSocket support
export function ensureSocketCompatibility() {
  if (typeof window !== 'undefined' && !window.WebSocket) {
    console.warn('WebSocket not supported, falling back to polling')
    return false
  }
  return true
}
