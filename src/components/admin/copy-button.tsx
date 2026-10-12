"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

/** For browsers without the clipboard API (or a page served over plain http). */
function legacyCopy(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

type Props = Omit<ComponentProps<typeof Button>, "onClick" | "children"> & {
  text: string;
  label: string;
  /** Runs after a successful copy. */
  onCopied?: () => void;
  /** Runs when the browser refused, so the page can show the text to copy by hand. */
  onFailed?: () => void;
};

/**
 * Copies a long prompt in one tap. The label turns into "کپی شد" for a moment; both labels share
 * one grid cell so the button keeps its width.
 */
export function CopyButton({ text, label, onCopied, onFailed, className, ...props }: Props) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopy(text);
    }
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    if (ok) {
      onCopied?.();
      timer.current = setTimeout(() => setState("idle"), 2400);
    } else {
      onFailed?.();
    }
  }

  const copied = state === "copied";
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={copy} className={cn("w-fit", className)} {...props}>
        {copied ? <Check strokeWidth={2.25} aria-hidden /> : <Copy strokeWidth={1.75} aria-hidden />}
        <span className="grid">
          <span className={cn("col-start-1 row-start-1", copied && "invisible")}>{label}</span>
          <span className={cn("col-start-1 row-start-1", !copied && "invisible")} aria-hidden={!copied}>
            {t("common.copied")}
          </span>
        </span>
      </Button>
      <span role="status" className="sr-only">
        {copied ? t("common.copied") : ""}
      </span>
      {state === "failed" ? <p className="text-bad text-[13.5px] leading-6">{t("admin.batch.prompt.copyFailed")}</p> : null}
    </div>
  );
}
