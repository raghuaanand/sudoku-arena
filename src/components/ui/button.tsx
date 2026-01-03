import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary - Main CTA, filled with brand color
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-[0.98] active:shadow-none",
        
        // Secondary - Muted background, less prominent
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/90 active:scale-[0.98]",
        
        // Outline - Bordered, transparent background
        outline:
          "border border-border bg-transparent hover:bg-muted hover:border-border-strong active:scale-[0.98]",
        
        // Ghost - No border, transparent, minimal
        ghost:
          "hover:bg-muted active:bg-muted/80",
        
        // Destructive - For dangerous actions
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:scale-[0.98]",
        
        // Link - Text only, underline on hover
        link:
          "text-primary underline-offset-4 hover:underline p-0 h-auto",
        
        // Premium - Gradient background, elevated
        premium:
          "bg-gradient-to-r from-primary to-primary-light text-primary-foreground shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]",
        
        // Soft - Muted primary background
        soft:
          "bg-primary/10 text-primary hover:bg-primary/15 active:bg-primary/20",
        
        // Success - Positive action
        success:
          "bg-success text-success-foreground shadow-sm hover:bg-success/90 active:scale-[0.98]",

        // Glass - Glassmorphism effect
        glass:
          "bg-card/80 backdrop-blur-md border border-border/50 text-foreground shadow-sm hover:bg-card hover:shadow-md active:scale-[0.98]",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3 text-xs rounded-lg",
        lg: "h-12 px-7 text-base rounded-xl",
        xl: "h-14 px-8 text-base rounded-2xl",
        icon: "h-10 w-10 p-0",
        "icon-sm": "h-8 w-8 p-0 rounded-lg",
        "icon-lg": "h-12 w-12 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <svg
              className="animate-spin -ml-1"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Loading...</span>
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
