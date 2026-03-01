import { cn } from "@/lib/utils"

function Button({ className, variant = "default", size = "default", ...props }) {
  const variants = {
    default: "bg-accent text-white hover:bg-accent-hover",
    secondary: "bg-bg-elevated text-text-primary hover:bg-bg-overlay",
    ghost: "bg-transparent hover:bg-bg-elevated text-text-secondary",
    outline: "border border-border bg-transparent hover:bg-bg-elevated text-text-primary",
  }

  const sizes = {
    default: "h-9 px-4 py-2 text-sm",
    sm: "h-7 px-3 text-xs",
    lg: "h-11 px-8 text-base",
    icon: "h-9 w-9",
  }

  return (
    <button
      data-slot="button"
      className={cn(
        "inline-flex items-center justify-center rounded-md font-mono",
        "transition-colors cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant] || variants.default,
        sizes[size] || sizes.default,
        className
      )}
      {...props}
    />
  )
}

export { Button }
