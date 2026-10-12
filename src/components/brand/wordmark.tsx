import { cn } from "@/lib/utils";

/** The "polyra" wordmark: Fraunces with its soft, slightly wonky cut. Size comes from the caller. */
export function Wordmark({ className, as: Tag = "span" }: { className?: string; as?: "span" | "p" }) {
  return (
    <Tag
      className={cn("lat text-brand-text w-fit leading-none font-[640] tracking-[-0.02em]", className)}
      style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1, "opsz" 144' }}
    >
      polyra
    </Tag>
  );
}
