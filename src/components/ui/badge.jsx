import { cn } from "@/lib/utils"

function Badge({ className, variant = "default", ...props }) {
  const variants = {
    default: "bg-accent text-white",
    secondary: "bg-bg-elevated text-text-secondary",
    outline: "border border-border text-text-secondary",
  }

  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-mono",
        "transition-colors",
        variants[variant] || variants.default,
        className
      )}
      {...props}
    />
  )
}

export { Badge }
