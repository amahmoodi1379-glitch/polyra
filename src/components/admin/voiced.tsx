import { isolateLatin } from "@/lib/bidi";
import { cn } from "@/lib/utils";

export type Voice = "fa" | "target";

/** Text in the language being learned (Latin serif, left to right) or Persian with Latin runs isolated. */
export function Voiced({ text, voice, language, className }: { text: string; voice: Voice; language: string; className?: string }) {
  if (voice === "target") {
    return (
      <span dir="ltr" lang={language} className={cn("lat", className)}>
        {text}
      </span>
    );
  }
  return <span className={className}>{isolateLatin(text)}</span>;
}
