"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { Segmented, Toggle } from "@/app/admin/content/[type]/[id]/form-kit";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AccessChange, AdminLanguage } from "@/server/accounts";
import { changeAccess } from "../actions";

type Access = { isAdmin: boolean; adminLanguage: AdminLanguage | null; isTester: boolean };

/**
 * «دسترسی» of one account. The tester switch and the panel language save at once; giving or taking
 * panel access asks first, because it opens or closes everything.
 */
export function AccessControls({ userId, phone, self, initial }: { userId: number; phone: string; self: boolean; initial: Access }) {
  const router = useRouter();
  const [access, setAccess] = useState<Access>(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (change: AccessChange, next: Access) => {
    const before = access;
    setAccess(next);
    setMessage(null);
    startTransition(async () => {
      const reply = await changeAccess(userId, change);
      if (reply.ok) {
        setMessage({ ok: true, text: t("admin.users.saved") });
        router.refresh();
      } else {
        setAccess(before);
        setMessage({ ok: false, text: reply.reason === "failed" ? t("admin.users.problems.failed", { code: reply.code }) : t(`admin.users.problems.${reply.reason}`) });
      }
    });
  };

  const setAdmin = (on: boolean) => save({ is_admin: on }, { ...access, isAdmin: on, adminLanguage: on ? (access.adminLanguage ?? "all") : null });

  return (
    <div className="flex flex-col">
      <div className="divide-line flex flex-col divide-y">
        <Row
          id="access-admin"
          title={t("admin.users.detail.adminTitle")}
          body={self ? t("admin.users.detail.adminSelf") : t("admin.users.detail.adminBody")}
          control={<Toggle id="access-admin" checked={access.isAdmin} onChange={(on) => setAsking(on)} label={t("admin.users.detail.adminTitle")} disabled={self || pending} />}
        >
          {access.isAdmin ? (
            <div className="bg-tint/45 mt-3 flex flex-col gap-2 rounded-[16px] px-4 py-3">
              <p className="text-ink text-[13.5px] font-bold">{t("admin.users.detail.languageTitle")}</p>
              <Segmented
                value={access.adminLanguage ?? "all"}
                onChange={(value) => save({ admin_language: value as AdminLanguage }, { ...access, adminLanguage: value as AdminLanguage })}
                label={t("admin.users.detail.languageTitle")}
                options={[
                  { value: "fr", label: t("common.languages.fr") },
                  { value: "de", label: t("common.languages.de") },
                  { value: "all", label: t("admin.users.languages.all") },
                ]}
              />
              <p className="text-ink-3 text-[12.5px] leading-6">{t("admin.users.detail.languageHint")}</p>
            </div>
          ) : null}
        </Row>
        <Row
          id="access-tester"
          title={t("admin.users.detail.testerTitle")}
          body={t("admin.users.detail.testerBody")}
          control={
            <Toggle
              id="access-tester"
              checked={access.isTester}
              onChange={(on) => save({ is_tester: on }, { ...access, isTester: on })}
              label={t("admin.users.detail.testerTitle")}
              disabled={pending}
            />
          }
        />
      </div>

      <div role="status" aria-live="polite" className="px-5 sm:px-6">
        {pending ? (
          <p className="text-ink-3 flex items-center gap-1.5 pb-4 text-[13.5px] leading-6 font-bold">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />
            {t("common.loading")}
          </p>
        ) : message ? (
          <p className={cn("flex items-start gap-1.5 pb-4 text-[13.5px] leading-6 font-bold", message.ok ? "text-ink-2" : "text-bad")}>
            {message.ok ? <Check className="mt-1 size-4 shrink-0" strokeWidth={2.5} aria-hidden /> : <CircleAlert className="mt-1 size-4 shrink-0" strokeWidth={2} aria-hidden />}
            {message.text}
          </p>
        ) : null}
      </div>

      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(asking ? "admin.users.confirm.grantTitle" : "admin.users.confirm.revokeTitle", { phone })}</AlertDialogTitle>
            <AlertDialogDescription>{t(asking ? "admin.users.confirm.grantBody" : "admin.users.confirm.revokeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                const on = asking === true;
                setAsking(null);
                setAdmin(on);
              }}
            >
              {t(asking ? "admin.users.confirm.grant" : "admin.users.confirm.revoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ id, title, body, control, children }: { id: string; title: string; body: string; control: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <label htmlFor={id} className="text-ink text-[15.5px] font-extrabold">
            {title}
          </label>
          <p className="text-ink-2 max-w-[62ch] text-[13.5px] leading-6">{body}</p>
        </div>
        <span className="pt-0.5">{control}</span>
      </div>
      {children}
    </div>
  );
}
