import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 font-bold whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-out outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/45 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-destructive/25 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: "bg-brand text-on-brand shadow-[var(--btn-glow)] hover:bg-[color-mix(in_oklab,var(--brand),var(--brand-press)_35%)] active:bg-brand-press",
        destructive: "bg-bad-soft text-bad hover:bg-[color-mix(in_oklab,var(--bad-soft),var(--bad)_12%)]",
        outline: "border border-line-2 bg-surface text-ink hover:bg-tint",
        secondary: "bg-tint text-brand-text hover:bg-tint-2",
        ghost: "text-ink-2 hover:bg-tint hover:text-ink",
        link: "text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 rounded-[14px] px-5 text-[15px] has-[>svg]:px-4",
        xs: "h-7 gap-1 rounded-[8px] px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-9 gap-1.5 rounded-[12px] px-3.5 text-sm has-[>svg]:px-3",
        lg: "h-14 rounded-[20px] px-6 text-base font-extrabold has-[>svg]:px-5",
        icon: "size-11 rounded-[14px]",
        "icon-xs": "size-7 rounded-[8px] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-9 rounded-[12px]",
        "icon-lg": "size-14 rounded-[20px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
