/**
 * Deterministic Sudoku Puzzle Generator
 * 
 * Features:
 * - Seeded random number generator for reproducible puzzles
 * - Difficulty-based puzzle generation
 * - Both players in a match get the same puzzle (same seed)
 * - Server-side generation for anti-cheat
 */

import { Difficulty } from '@prisma/client'

export type SudokuGrid = (number | null)[][]

// ============================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================

/**
 * Simple seeded PRNG using Mulberry32 algorithm
 * Produces same sequence of random numbers for same seed
 */
function createSeededRandom(seed: string): () => number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  
  let state = hash >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Shuffle array in place using seeded random
 */
function shuffleArray<T>(array: T[], random: () => number): T[] {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// ============================================
// PUZZLE GENERATION
// ============================================

/**
 * Create an empty 9x9 grid
 */
function createEmptyGrid(): SudokuGrid {
  return Array(9).fill(null).map(() => Array(9).fill(null))
}

/**
 * Check if a number can be placed at a specific position
 */
function isValidPlacement(
  grid: SudokuGrid, 
  row: number, 
  col: number, 
  num: number
): boolean {
  // Check row
  for (let x = 0; x < 9; x++) {
    if (grid[row][x] === num) return false
  }

  // Check column
  for (let x = 0; x < 9; x++) {
    if (grid[x][col] === num) return false
  }

  // Check 3x3 box
  const boxRow = Math.floor(row / 3) * 3
  const boxCol = Math.floor(col / 3) * 3
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (grid[boxRow + i][boxCol + j] === num) return false
    }
  }

  return true
}

/**
 * Fill a 3x3 box with random valid numbers
 */
function fillBox(
  grid: SudokuGrid, 
  row: number, 
  col: number, 
  random: () => number
): void {
  const nums = shuffleArray([1, 2, 3, 4, 5, 6, 7, 8, 9], random)
  let index = 0
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      grid[row + i][col + j] = nums[index++]
    }
  }
}

/**
 * Solve the sudoku using backtracking with randomized order
 */
function solveSudoku(grid: SudokuGrid, random: () => number): boolean {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (grid[row][col] === null) {
        const nums = shuffleArray([1, 2, 3, 4, 5, 6, 7, 8, 9], random)
        for (const num of nums) {
          if (isValidPlacement(grid, row, col, num)) {
            grid[row][col] = num
            if (solveSudoku(grid, random)) {
              return true
            }
            grid[row][col] = null
          }
        }
        return false
      }
    }
  }
  return true
}

/**
 * Generate a complete solved sudoku grid
 */
function generateCompletedGrid(random: () => number): SudokuGrid {
  const grid = createEmptyGrid()
  
  // Fill diagonal 3x3 boxes first (they don't affect each other)
  fillBox(grid, 0, 0, random)
  fillBox(grid, 3, 3, random)
  fillBox(grid, 6, 6, random)
  
  // Solve the rest
  solveSudoku(grid, random)
  
  return grid
}

/**
 * Check if the puzzle has a unique solution
 */
function hasUniqueSolution(puzzle: SudokuGrid): boolean {
  let solutionCount = 0
  
  function solve(grid: SudokuGrid): boolean {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (grid[row][col] === null) {
          for (let num = 1; num <= 9; num++) {
            if (isValidPlacement(grid, row, col, num)) {
              grid[row][col] = num
              if (solve(grid)) {
                return true
              }
              grid[row][col] = null
            }
          }
          return false
        }
      }
    }
    solutionCount++
    return solutionCount > 1 // Stop if we found more than one solution
  }
  
  const gridCopy = puzzle.map(row => [...row])
  solve(gridCopy)
  return solutionCount === 1
}

/**
 * Remove numbers from a complete grid to create a puzzle
 */
function createPuzzle(
  solution: SudokuGrid, 
  difficulty: Difficulty,
  random: () => number
): SudokuGrid {
  const puzzle = solution.map(row => [...row])
  
  // Number of cells to remove based on difficulty
  const cellsToRemove: Record<Difficulty, number> = {
    [Difficulty.EASY]: 35,    // ~46 clues
    [Difficulty.MEDIUM]: 45,  // ~36 clues
    [Difficulty.HARD]: 55,    // ~26 clues
  }

  const positions: [number, number][] = []
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      positions.push([row, col])
    }
  }

  const shuffledPositions = shuffleArray(positions, random)
  let removed = 0
  const targetRemoval = cellsToRemove[difficulty]

  for (const [row, col] of shuffledPositions) {
    if (removed >= targetRemoval) break

    const backup = puzzle[row][col]
    puzzle[row][col] = null

    // For hard puzzles, we check uniqueness
    // For easier puzzles, we skip this for performance
    if (difficulty === Difficulty.HARD) {
      if (!hasUniqueSolution(puzzle)) {
        puzzle[row][col] = backup
        continue
      }
    }

    removed++
  }

  return puzzle
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Generate a deterministic puzzle with a given seed
 * Same seed will always produce the same puzzle
 */
export function generateSeededPuzzle(
  seed: string, 
  difficulty: Difficulty
): { puzzle: SudokuGrid; solution: SudokuGrid } {
  const random = createSeededRandom(seed)
  
  const solution = generateCompletedGrid(random)
  const puzzle = createPuzzle(solution, difficulty, random)
  
  return { puzzle, solution }
}

/**
 * Validate a move against the solution
 */
export function validateMove(
  solution: SudokuGrid,
  row: number,
  col: number,
  value: number
): boolean {
  if (row < 0 || row >= 9 || col < 0 || col >= 9) return false
  if (value < 1 || value > 9) return false
  return solution[row][col] === value
}

/**
 * Count correct entries in a grid compared to solution
 */
export function countCorrectEntries(
  grid: SudokuGrid,
  solution: SudokuGrid,
  originalPuzzle: SudokuGrid
): number {
  let correct = 0
  
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      // Only count cells that were originally empty
      if (originalPuzzle[row][col] === null) {
        if (grid[row][col] !== null && grid[row][col] === solution[row][col]) {
          correct++
        }
      }
    }
  }
  
  return correct
}

/**
 * Check if a puzzle is complete
 */
export function isPuzzleComplete(grid: SudokuGrid): boolean {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (grid[row][col] === null) return false
    }
  }
  return true
}

/**
 * Check if a puzzle is solved correctly
 */
export function isPuzzleSolvedCorrectly(
  grid: SudokuGrid, 
  solution: SudokuGrid
): boolean {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (grid[row][col] !== solution[row][col]) return false
    }
  }
  return true
}

/**
 * Get empty cells count in a puzzle
 */
export function getEmptyCellsCount(puzzle: SudokuGrid): number {
  let count = 0
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (puzzle[row][col] === null) count++
    }
  }
  return count
}
