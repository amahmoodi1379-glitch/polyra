"use client";

import { useEffect, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { navDone, navStart } from "./nav-progress";

/**
 * The submit button of a form that runs a server action: from the click until the answer it turns
 * into a spinner and cannot be pressed again, so one tap makes one thing.
 */
export function SubmitButton({ children, disabled, ...props }: Omit<ComponentProps<typeof Button>, "type">) {
  const { pending } = useFormStatus();
  useEffect(() => {
    if (!pending) return;
    navStart();
    return navDone;
  }, [pending]);
  return (
    <Button type="submit" disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending ? <LoaderCircle className="motion-safe:animate-spin" strokeWidth={2} aria-hidden /> : null}
      {children}
    </Button>
  );
}
