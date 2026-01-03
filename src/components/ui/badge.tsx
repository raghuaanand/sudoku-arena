import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-primary/10 text-primary",
        secondary:
          "bg-secondary/10 text-secondary-foreground",
        success:
          "bg-success/10 text-success",
        warning:
          "bg-warning/10 text-amber-700 dark:text-amber-400",
        destructive:
          "bg-destructive/10 text-destructive",
        outline:
          "border border-border bg-transparent text-foreground",
        muted:
          "bg-muted text-muted-foreground",
        // For live/online indicators
        live:
          "bg-success/10 text-success before:content-[''] before:w-1.5 before:h-1.5 before:bg-success before:rounded-full before:animate-pulse",
      },
      size: {
        default: "px-2.5 py-0.5 text-xs",
        sm: "px-2 py-0.5 text-[10px]",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
