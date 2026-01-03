'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { SudokuCellProps, SudokuGridProps } from '@/types'
import { isValidMove, isComplete } from '@/utils/sudoku'
import { Button } from '@/components/ui/button'
import { Delete, Check } from 'lucide-react'

// Individual Sudoku Cell Component
const SudokuCellComponent: React.FC<SudokuCellProps> = ({
  value,
  row,
  col,
  isSelected,
  isHighlighted,
  isError,
  isReadonly,
  onChange,
  onSelect,
}) => {
  const handleClick = useCallback(() => {
    if (!isReadonly) {
      onSelect(row, col)
    }
  }, [row, col, isReadonly, onSelect])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isReadonly) return

      const key = e.key
      if (key >= '1' && key <= '9') {
        const num = parseInt(key, 10)
        onChange(row, col, num)
      } else if (key === 'Backspace' || key === 'Delete' || key === '0') {
        onChange(row, col, 0)
      }
    },
    [row, col, isReadonly, onChange]
  )

  // Calculate box boundaries for styling
  const isRightBorder = col === 2 || col === 5
  const isBottomBorder = row === 2 || row === 5
  const isTopRow = row === 0
  const isLeftCol = col === 0
  const isBottomRow = row === 8
  const isRightCol = col === 8

  return (
    <div
      className={cn(
        // Base styles
        'aspect-square flex items-center justify-center',
        'text-base sm:text-lg md:text-xl font-semibold',
        'transition-all duration-150 select-none',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset',
        'border-r border-b border-border',
        
        // Box borders (thicker at 3x3 boundaries)
        isRightBorder && 'border-r-2 border-r-foreground/20',
        isBottomBorder && 'border-b-2 border-b-foreground/20',
        isTopRow && 'border-t-0',
        isLeftCol && 'border-l-0',
        
        // Corner rounding
        row === 0 && col === 0 && 'rounded-tl-xl',
        row === 0 && col === 8 && 'rounded-tr-xl border-r-0',
        row === 8 && col === 0 && 'rounded-bl-xl border-b-0',
        row === 8 && col === 8 && 'rounded-br-xl border-r-0 border-b-0',
        isBottomRow && 'border-b-0',
        isRightCol && 'border-r-0',
        
        // State-based styling
        isSelected
          ? 'bg-primary/15 text-primary ring-2 ring-primary ring-inset'
          : isHighlighted
          ? 'bg-primary/5'
          : isError
          ? 'bg-destructive/10 text-destructive'
          : isReadonly && value !== null
          ? 'bg-muted/50 text-foreground font-bold'
          : 'bg-card hover:bg-muted/30',
        
        // Cursor
        isReadonly ? 'cursor-default' : 'cursor-pointer'
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={isReadonly ? -1 : 0}
      role="gridcell"
      aria-label={`Cell ${row + 1}, ${col + 1}${value ? `, value ${value}` : ', empty'}`}
    >
      {value || ''}
    </div>
  )
}

// Main Sudoku Grid Component
export const SudokuGridComponent: React.FC<SudokuGridProps> = ({
  grid,
  solution,
  isReadonly = false,
  onGridChange,
  className,
}) => {
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)
  const [highlightedNumber, setHighlightedNumber] = useState<number | null>(null)
  const [errors, setErrors] = useState<Set<string>>(new Set())

  const handleCellSelect = useCallback((row: number, col: number) => {
    setSelectedCell({ row, col })
    const cellValue = grid[row][col]
    setHighlightedNumber(cellValue)
  }, [grid])

  const handleCellChange = useCallback(
    (row: number, col: number, value: number) => {
      if (isReadonly) return

      const newGrid = grid.map((gridRow, rowIndex) =>
        gridRow.map((cell, colIndex) => {
          if (rowIndex === row && colIndex === col) {
            return value === 0 ? null : value
          }
          return cell
        })
      )

      // Check for errors
      const newErrors = new Set<string>()
      if (value !== 0 && !isValidMove(grid, row, col, value)) {
        newErrors.add(`${row}-${col}`)
      }
      setErrors(newErrors)

      onGridChange?.(newGrid)
      setHighlightedNumber(value === 0 ? null : value)
    },
    [grid, isReadonly, onGridChange]
  )

  const handleNumberInput = useCallback((num: number) => {
    if (selectedCell && !isReadonly) {
      handleCellChange(selectedCell.row, selectedCell.col, num)
    }
  }, [selectedCell, isReadonly, handleCellChange])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedCell || isReadonly) return

      const { row, col } = selectedCell
      let newRow = row
      let newCol = col

      switch (e.key) {
        case 'ArrowUp':
          newRow = Math.max(0, row - 1)
          break
        case 'ArrowDown':
          newRow = Math.min(8, row + 1)
          break
        case 'ArrowLeft':
          newCol = Math.max(0, col - 1)
          break
        case 'ArrowRight':
          newCol = Math.min(8, col + 1)
          break
        default:
          return
      }

      e.preventDefault()
      setSelectedCell({ row: newRow, col: newCol })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedCell, isReadonly])

  const isCompleted = isComplete(grid)

  return (
    <div className={cn('flex flex-col items-center gap-6', className)}>
      {/* Grid */}
      <div
        className="grid grid-cols-9 border-2 border-foreground/20 rounded-xl overflow-hidden shadow-lg bg-card"
        style={{ 
          width: '100%',
          maxWidth: '400px',
          aspectRatio: '1 / 1'
        }}
        role="grid"
        aria-label="Sudoku puzzle"
      >
        {grid.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const cellKey = `${rowIndex}-${colIndex}`
            const isSelected = selectedCell?.row === rowIndex && selectedCell?.col === colIndex
            const isHighlighted = highlightedNumber !== null && cell === highlightedNumber && !isSelected
            const isError = errors.has(cellKey)
            const cellIsReadonly = isReadonly || (solution && solution[rowIndex][colIndex] !== null) || false

            return (
              <SudokuCellComponent
                key={cellKey}
                value={cell}
                row={rowIndex}
                col={colIndex}
                isSelected={isSelected}
                isHighlighted={isHighlighted}
                isError={isError}
                isReadonly={cellIsReadonly}
                onChange={handleCellChange}
                onSelect={handleCellSelect}
              />
            )
          })
        )}
      </div>

      {/* Number Input Buttons (Mobile) */}
      {!isReadonly && (
        <div className="w-full max-w-[400px] space-y-3">
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((num) => (
              <Button
                key={num}
                variant={highlightedNumber === num ? 'default' : 'outline'}
                size="lg"
                className="h-12 text-lg font-semibold"
                onClick={() => handleNumberInput(num)}
                disabled={!selectedCell}
              >
                {num}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-2">
            {[6, 7, 8, 9].map((num) => (
              <Button
                key={num}
                variant={highlightedNumber === num ? 'default' : 'outline'}
                size="lg"
                className="h-12 text-lg font-semibold"
                onClick={() => handleNumberInput(num)}
                disabled={!selectedCell}
              >
                {num}
              </Button>
            ))}
            <Button
              variant="destructive"
              size="lg"
              className="h-12"
              onClick={() => handleNumberInput(0)}
              disabled={!selectedCell}
            >
              <Delete className="w-5 h-5" />
            </Button>
          </div>
        </div>
      )}

      {/* Game Status */}
      {isCompleted && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-success/10 text-success">
          <Check className="w-5 h-5" />
          <span className="font-semibold">Puzzle Completed!</span>
        </div>
      )}
      
      {errors.size > 0 && (
        <div className="text-destructive text-sm font-medium">
          Invalid move detected
        </div>
      )}
    </div>
  )
}
