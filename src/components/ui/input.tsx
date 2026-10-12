import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-[16px] border border-input bg-surface px-4 text-base text-ink transition-[border-color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-ink-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-brand-soft focus-visible:ring-[3px] focus-visible:ring-ring/30",
        "aria-invalid:border-bad aria-invalid:ring-[3px] aria-invalid:ring-bad/15",
        className
      )}
      {...props}
    />
  )
}

export { Input }
