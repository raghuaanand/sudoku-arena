// Type definitions for the Sudoku Arena application

// ============================================
// Enums (mirror Prisma schema)
// ============================================

export type MatchType = 'SINGLE_PLAYER' | 'MULTIPLAYER_FREE' | 'MULTIPLAYER_PAID'
export type MatchStatus = 'WAITING' | 'PAYMENT_PENDING' | 'READY' | 'ONGOING' | 'FINISHED' | 'CANCELLED' | 'REFUNDED'
export type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'ENTRY_FEE' | 'ESCROW_LOCK' | 'ESCROW_RELEASE' | 'WINNINGS' | 'REFUND' | 'PLATFORM_FEE'
export type EscrowStatus = 'NONE' | 'PLAYER1_LOCKED' | 'BOTH_LOCKED' | 'RELEASED' | 'REFUNDED'
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED'
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT'

export interface User {
  id: string
  name?: string
  email: string
  password?: string
  emailVerified?: Date
  image?: string
  skillRating: number
  matchesPlayed: number
  matchesWon: number
  createdAt: Date
  updatedAt: Date
  wallet?: Wallet
}

export interface Wallet {
  id: string
  userId: string
  balance: number // in paisa (INR * 100)
  lockedBalance: number // funds in escrow
  version: number // for optimistic locking
  createdAt: Date
  updatedAt: Date
}

export interface Match {
  id: string
  type: MatchType
  difficulty: Difficulty
  entryFee: number // in paisa
  prizePool: number // in paisa
  platformFee: number // in paisa
  sudokuGrid: string // JSON puzzle
  solution: string // JSON solution
  seed: number // for deterministic generation
  player1Id: string
  player2Id?: string
  winnerId?: string
  player1Score: number
  player2Score: number
  player1FinishedAt?: Date
  player2FinishedAt?: Date
  status: MatchStatus
  escrowStatus: EscrowStatus
  timeLimit: number // seconds
  startedAt?: Date
  endedAt?: Date
  createdAt: Date
  updatedAt: Date
  player1?: User
  player2?: User
  moves?: MatchMove[]
}

export interface MatchMove {
  id: string
  matchId: string
  playerId: string
  row: number
  col: number
  value: number
  isCorrect: boolean
  pointsAwarded: number
  timestamp: Date
}

export interface Transaction {
  id: string
  walletId: string
  matchId?: string
  amount: number // in paisa
  type: TransactionType
  description?: string
  reference?: string // razorpay order/payment id
  balanceBefore: number
  balanceAfter: number
  createdAt: Date
  wallet?: Wallet
}

export interface PaymentOrder {
  id: string
  razorpayOrderId: string
  razorpayPaymentId?: string
  userId: string
  matchId?: string
  amount: number // in paisa
  currency: string
  status: PaymentStatus
  idempotencyKey: string
  webhookPayload?: string
  createdAt: Date
  updatedAt: Date
}

export interface MatchmakingQueueEntry {
  id: string
  userId: string
  entryFee: number
  difficulty: Difficulty
  matchedMatchId?: string
  expiresAt: Date
  createdAt: Date
}

// Sudoku grid types
export type SudokuCell = number | null
export type SudokuGrid = SudokuCell[][]

// Game state types
export interface GameState {
  grid: SudokuGrid
  solution: SudokuGrid
  startTime: Date
  endTime?: Date
  isComplete: boolean
  errors: number
  score: number
}

// Server game state (authoritative)
export interface ServerGameState {
  matchId: string
  puzzle: number[][]
  solution: number[][]
  playerStates: Record<string, PlayerGameState>
  status: 'WAITING' | 'ONGOING' | 'FINISHED'
  startTime?: number
  endTime?: number
  timeLimit: number
  winnerId?: string
}

export interface PlayerGameState {
  userId: string
  grid: number[][]
  score: number
  lastMoveAt?: number
  finishedAt?: number
  connected: boolean
}

// Socket event types
export interface ServerToClientEvents {
  'game:state': (state: ServerGameState) => void
  'game:start': (data: { matchId: string; puzzle: number[][]; timeLimit: number; startTime: number }) => void
  'game:move': (data: { playerId: string; row: number; col: number; isCorrect: boolean; score: number }) => void
  'game:scores': (scores: Record<string, number>) => void
  'game:end': (data: { winnerId?: string; reason: string; finalScores: Record<string, number> }) => void
  'player:joined': (data: { userId: string; name?: string }) => void
  'player:left': (data: { userId: string }) => void
  'player:reconnected': (data: { userId: string }) => void
  'queue:status': (data: { position: number; estimatedWait: number }) => void
  'queue:matched': (data: { matchId: string }) => void
  'error': (data: { code: string; message: string }) => void
  'chat:message': (data: { userId: string; message: string; timestamp: number }) => void
}

export interface ClientToServerEvents {
  'game:join': (matchId: string) => void
  'game:move': (data: { matchId: string; row: number; col: number; value: number }) => void
  'game:leave': (matchId: string) => void
  'queue:join': (data: { entryFee: number; difficulty: Difficulty }) => void
  'queue:leave': () => void
  'chat:send': (data: { matchId: string; message: string }) => void
}

// Legacy socket events (for backwards compatibility)
export interface SocketEvents {
  'player:join': (matchId: string) => void
  'player:progress': (grid: SudokuGrid) => void
  'player:solved': (time: number) => void
  'player:left': () => void
  'game:start': (match: Match) => void
  'game:end': (winner: string) => void
}

// API response types
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

// Form types
export interface LoginForm {
  email: string
  password: string
}

export interface RegisterForm {
  name: string
  email: string
  password: string
  confirmPassword: string
}

export interface WalletForm {
  amount: number
}

// Component props types
export interface SudokuCellProps {
  value: SudokuCell
  row: number
  col: number
  isSelected: boolean
  isHighlighted: boolean
  isError: boolean
  isReadonly: boolean
  isUserEntry: boolean // true if this is a user-entered value (not original puzzle)
  isHint: boolean // true if this cell was filled by a hint
  isRevealed: boolean // true if this cell was revealed after submit (was empty/wrong)
  onChange: (row: number, col: number, value: number) => void
  onSelect: (row: number, col: number) => void
}

export interface SudokuGridProps {
  grid: SudokuGrid
  originalPuzzle?: SudokuGrid // The original puzzle to distinguish user entries
  hintCells?: Set<string> // Set of "row-col" strings for cells filled by hints
  revealedCells?: Set<string> // Set of "row-col" strings for cells revealed after submit
  solution?: SudokuGrid
  isReadonly?: boolean
  onGridChange?: (grid: SudokuGrid) => void
  className?: string
}

export interface MatchCardProps {
  match: Match
  onJoin?: (matchId: string) => void
  onView?: (matchId: string) => void
}

// Responsive breakpoint types
export type BreakpointKey = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

export interface ResponsiveValue<T> {
  base?: T
  sm?: T
  md?: T
  lg?: T
  xl?: T
  '2xl'?: T
}

// ============================================
// Queue API Types
// ============================================

export interface QueueJoinRequest {
  entryFee: number // in paisa
  difficulty: Difficulty
}

export interface QueueJoinResponse {
  status: 'queued' | 'matched'
  queueId?: string
  matchId?: string
  position?: number
}

export interface QueueStatusResponse {
  inQueue: boolean
  position?: number
  expiresAt?: string
}

// ============================================
// Game Move API Types
// ============================================

export interface GameMoveRequest {
  row: number
  col: number
  value: number
}

export interface GameMoveResponse {
  success: boolean
  isCorrect: boolean
  pointsAwarded: number
  currentScore: number
  gameOver: boolean
  winnerId?: string
}

// ============================================
// Payment API Types
// ============================================

export interface CreateOrderRequest {
  amount: number // in paisa
  matchId?: string
}

export interface CreateOrderResponse {
  orderId: string
  razorpayOrderId: string
  amount: number
  currency: string
}

export interface VerifyPaymentRequest {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}

// ============================================
// Wallet API Types
// ============================================

export interface WalletResponse {
  balance: number
  lockedBalance: number
  availableBalance: number
}

export interface WithdrawRequest {
  amount: number // in paisa
  bankAccountId: string
}

// ============================================
// Audit Log Types
// ============================================

export interface AuditLogEntry {
  id: string
  action: string
  entityType: string
  entityId: string
  actorId?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
  timestamp: Date
}
