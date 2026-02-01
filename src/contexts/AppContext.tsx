'use client'

import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react'
import { User, Match, Transaction } from '@/types'

// Game State
interface GameState {
  currentMatch: Match | null
  isPlaying: boolean
  timeElapsed: number
  score: number
}

// App State
interface AppState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  game: GameState
  matches: Match[]
  transactions: Transaction[]
  wallet: {
    balance: number
    isLoading: boolean
  }
}

// Actions
type AppAction =
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_CURRENT_MATCH'; payload: Match | null }
  | { type: 'SET_IS_PLAYING'; payload: boolean }
  | { type: 'SET_TIME_ELAPSED'; payload: number }
  | { type: 'SET_SCORE'; payload: number }
  | { type: 'SET_MATCHES'; payload: Match[] }
  | { type: 'ADD_MATCH'; payload: Match }
  | { type: 'UPDATE_MATCH'; payload: Match }
  | { type: 'SET_TRANSACTIONS'; payload: Transaction[] }
  | { type: 'ADD_TRANSACTION'; payload: Transaction }
  | { type: 'SET_WALLET_BALANCE'; payload: number }
  | { type: 'SET_WALLET_LOADING'; payload: boolean }
  | { type: 'RESET_GAME' }
  | { type: 'LOGOUT' }

const initialState: AppState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  game: {
    currentMatch: null,
    isPlaying: false,
    timeElapsed: 0,
    score: 0,
  },
  matches: [],
  transactions: [],
  wallet: {
    balance: 0,
    isLoading: false,
  },
}

// Reducer
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_USER':
      return {
        ...state,
        user: action.payload,
        isAuthenticated: action.payload !== null,
        wallet: {
          ...state.wallet,
          balance: action.payload?.wallet?.balance || 0,
        },
      }

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      }

    case 'SET_CURRENT_MATCH':
      return {
        ...state,
        game: {
          ...state.game,
          currentMatch: action.payload,
        },
      }

    case 'SET_IS_PLAYING':
      return {
        ...state,
        game: {
          ...state.game,
          isPlaying: action.payload,
        },
      }

    case 'SET_TIME_ELAPSED':
      return {
        ...state,
        game: {
          ...state.game,
          timeElapsed: action.payload,
        },
      }

    case 'SET_SCORE':
      return {
        ...state,
        game: {
          ...state.game,
          score: action.payload,
        },
      }

    case 'SET_MATCHES':
      return {
        ...state,
        matches: action.payload,
      }

    case 'ADD_MATCH':
      return {
        ...state,
        matches: [action.payload, ...state.matches],
      }

    case 'UPDATE_MATCH':
      return {
        ...state,
        matches: state.matches.map(match =>
          match.id === action.payload.id ? action.payload : match
        ),
        game: {
          ...state.game,
          currentMatch:
            state.game.currentMatch?.id === action.payload.id
              ? action.payload
              : state.game.currentMatch,
        },
      }

    case 'SET_TRANSACTIONS':
      return {
        ...state,
        transactions: action.payload,
      }

    case 'ADD_TRANSACTION':
      return {
        ...state,
        transactions: [action.payload, ...state.transactions],
      }

    case 'SET_WALLET_BALANCE':
      return {
        ...state,
        wallet: {
          ...state.wallet,
          balance: action.payload,
        },
        user: state.user
          ? {
              ...state.user,
              wallet: state.user.wallet
                ? { ...state.user.wallet, balance: action.payload }
                : { id: '', userId: state.user.id, balance: action.payload, lockedBalance: 0, version: 0, createdAt: new Date(), updatedAt: new Date() },
            }
          : null,
      }

    case 'SET_WALLET_LOADING':
      return {
        ...state,
        wallet: {
          ...state.wallet,
          isLoading: action.payload,
        },
      }

    case 'RESET_GAME':
      return {
        ...state,
        game: {
          currentMatch: null,
          isPlaying: false,
          timeElapsed: 0,
          score: 0,
        },
      }

    case 'LOGOUT':
      return {
        ...initialState,
        isLoading: false,
      }

    default:
      return state
  }
}

// Context
interface AppContextType {
  state: AppState
  dispatch: React.Dispatch<AppAction>
}

const AppContext = createContext<AppContextType | undefined>(undefined)

// Provider Component
interface AppProviderProps {
  children: ReactNode
}

export function AppProvider({ children }: AppProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialState)

  // Timer effect for game time tracking
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null

    if (state.game.isPlaying) {
      interval = setInterval(() => {
        dispatch({ type: 'SET_TIME_ELAPSED', payload: state.game.timeElapsed + 1 })
      }, 1000)
    } else if (interval) {
      clearInterval(interval)
    }

    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [state.game.isPlaying, state.game.timeElapsed])

  const value = {
    state,
    dispatch,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// Hook to use the context
export function useApp() {
  const context = useContext(AppContext)
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}

// Selector hooks for specific state slices
export function useAuth() {
  const { state } = useApp()
  return {
    user: state.user,
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
  }
}

export function useGame() {
  const { state, dispatch } = useApp()
  return {
    ...state.game,
    startGame: (match: Match) => {
      dispatch({ type: 'SET_CURRENT_MATCH', payload: match })
      dispatch({ type: 'SET_IS_PLAYING', payload: true })
      dispatch({ type: 'SET_TIME_ELAPSED', payload: 0 })
    },
    endGame: () => {
      dispatch({ type: 'SET_IS_PLAYING', payload: false })
    },
    resetGame: () => {
      dispatch({ type: 'RESET_GAME' })
    },
  }
}

export function useWallet() {
  const { state, dispatch } = useApp()
  return {
    ...state.wallet,
    setBalance: (balance: number) => {
      dispatch({ type: 'SET_WALLET_BALANCE', payload: balance })
    },
    setLoading: (loading: boolean) => {
      dispatch({ type: 'SET_WALLET_LOADING', payload: loading })
    },
  }
}

export function useMatches() {
  const { state, dispatch } = useApp()
  return {
    matches: state.matches,
    setMatches: (matches: Match[]) => {
      dispatch({ type: 'SET_MATCHES', payload: matches })
    },
    addMatch: (match: Match) => {
      dispatch({ type: 'ADD_MATCH', payload: match })
    },
    updateMatch: (match: Match) => {
      dispatch({ type: 'UPDATE_MATCH', payload: match })
    },
  }
}

export function useTransactions() {
  const { state, dispatch } = useApp()
  return {
    transactions: state.transactions,
    setTransactions: (transactions: Transaction[]) => {
      dispatch({ type: 'SET_TRANSACTIONS', payload: transactions })
    },
    addTransaction: (transaction: Transaction) => {
      dispatch({ type: 'ADD_TRANSACTION', payload: transaction })
    },
  }
}
