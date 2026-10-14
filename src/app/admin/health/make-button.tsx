"use client";

import { useFormStatus } from "react-dom";
import { ClipboardPaste, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export function MakeButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <LoaderCircle className="motion-safe:animate-spin" strokeWidth={2} aria-hidden /> : <ClipboardPaste strokeWidth={1.75} aria-hidden />}
      {t("admin.health.sentences.make")}
    </Button>
  );
}
