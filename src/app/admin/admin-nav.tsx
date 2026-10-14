"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import {
  ArrowDownUp,
  AudioLines,
  BookCheck,
  BookOpen,
  ClipboardPaste,
  History,
  Inbox,
  Library,
  ListOrdered,
  LogOut,
  MessageSquareText,
  Activity,
  Settings2,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { setAdminLanguage, signOut } from "./actions";

type NavItem = { href: string; label: MessageKey; icon: LucideIcon; exact?: boolean };
type NavGroup = { label: MessageKey; items: NavItem[] };

function navGroups(showTestCodes: boolean): NavGroup[] {
  return [
    { label: "admin.nav.today", items: [{ href: "/admin", label: "admin.nav.workbench", icon: Inbox, exact: true }] },
    {
      label: "admin.nav.content",
      items: [
        { href: "/admin/create", label: "admin.nav.create", icon: ClipboardPaste },
        { href: "/admin/content", label: "admin.nav.library", icon: Library },
        { href: "/admin/order", label: "admin.nav.order", icon: ListOrdered },
        { href: "/admin/audio", label: "admin.nav.audio", icon: AudioLines },
        { href: "/admin/publish", label: "admin.nav.publish", icon: BookCheck },
        { href: "/admin/transfer", label: "admin.nav.transfer", icon: ArrowDownUp },
      ],
    },
    { label: "admin.nav.quality", items: [{ href: "/admin/health", label: "admin.nav.health", icon: Activity }] },
    { label: "admin.nav.people", items: [{ href: "/admin/users", label: "admin.nav.users", icon: Users }] },
    {
      label: "admin.nav.settings",
      items: [
        { href: "/admin/settings/engine", label: "admin.nav.engine", icon: SlidersHorizontal },
        { href: "/admin/settings/general", label: "admin.nav.general", icon: Settings2 },
        { href: "/admin/log", label: "admin.nav.log", icon: History },
      ],
    },
    {
      label: "admin.nav.help",
      items: [
        { href: "/admin/guide", label: "admin.nav.guide", icon: BookOpen },
        { href: "/admin/errors", label: "admin.nav.errors", icon: TriangleAlert },
        ...(showTestCodes ? [{ href: "/admin/test-codes", label: "admin.nav.testCodes", icon: MessageSquareText } as NavItem] : []),
      ],
    },
  ];
}

const languages = [
  { value: "fr", label: "common.languages.fr" },
  { value: "de", label: "common.languages.de" },
  { value: "all", label: "admin.languageAll" },
] as const;

export function LanguageScope({ current }: { current: string }) {
  const [optimistic, setOptimistic] = useOptimistic(current);
  const [, startTransition] = useTransition();
  return (
    <div role="radiogroup" aria-label={t("admin.languageScope")} className="bg-tint grid grid-cols-3 gap-1 rounded-[16px] p-1">
      {languages.map((language) => {
        const selected = optimistic === language.value;
        return (
          <button
            key={language.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() =>
              startTransition(async () => {
                setOptimistic(language.value);
                await setAdminLanguage(language.value);
              })
            }
            className={cn(
              "h-9 rounded-[12px] text-[13px] font-bold transition-[background-color,color,box-shadow] duration-150",
              selected ? "bg-surface dark:bg-tint-2 text-brand-text shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
            )}
          >
            {t(language.label)}
          </button>
        );
      })}
    </div>
  );
}

export function AdminNav({ showTestCodes, onNavigate }: { showTestCodes: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5">
      {navGroups(showTestCodes).map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="text-ink-3 px-3 pb-1 text-[12.5px] font-bold">{t(group.label)}</p>
          {group.items.map((item) => {
            const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-3 rounded-[12px] px-3 text-[14.5px] transition-colors duration-150",
                  active ? "bg-tint text-brand-text font-bold" : "text-ink-2 hover:bg-tint/60 hover:text-ink",
                )}
              >
                <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
                {t(item.label)}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Wordmark with the panel's name beside it, at the top of the side bar and the mobile menu. */
export function PanelMark() {
  return (
    <span className="flex items-baseline gap-2.5 px-3">
      <Wordmark className="text-[26px]" />
      <span className="text-ink-3 text-[13px] font-bold">{t("admin.panelName")}</span>
    </span>
  );
}

/** Signed-in phone number and the sign-out button, on one line at the bottom of the menu. */
export function AccountRow({ phone }: { phone: string }) {
  return (
    <div className="border-line mt-auto flex items-center justify-between gap-2 border-t pt-3">
      <span dir="ltr" className="text-ink-3 num px-3 text-[13px]">
        {phone}
      </span>
      <form action={signOut}>
        <button type="submit" className="text-ink-2 hover:bg-tint hover:text-ink flex min-h-10 items-center gap-2 rounded-[12px] px-3 text-[14px] transition-colors">
          <LogOut className="size-[17px] shrink-0 rtl:-scale-x-100" strokeWidth={1.75} aria-hidden />
          {t("admin.logout")}
        </button>
      </form>
    </div>
  );
}
