import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  icon?: React.ReactNode
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, icon, ...props }, ref) => {
    return (
      <div className="relative">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            {icon}
          </div>
        )}
        <input
          type={type}
          className={cn(
            "flex h-11 w-full rounded-xl border bg-card px-4 py-2.5 text-sm transition-all duration-200",
            "placeholder:text-muted-foreground/60",
            "focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary/50",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted",
            "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
            error 
              ? "border-destructive/50 focus:border-destructive focus:ring-destructive/20" 
              : "border-border hover:border-border-strong",
            icon && "pl-10",
            className
          )}
          ref={ref}
          {...props}
        />
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input }
