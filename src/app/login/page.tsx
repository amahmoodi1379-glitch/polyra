import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { t } from "@/i18n";
import { getCurrentUser } from "@/server/auth/session";
import { LoginFlow } from "./login-flow";

export const metadata: Metadata = { title: t("login.title") };

function safeNext(value: string | string[] | undefined) {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNext((await searchParams).next);
  if (await getCurrentUser()) redirect(next);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col px-5 pt-[max(12vh,48px)] pb-10 sm:justify-center sm:pt-10 sm:pb-[14vh]">
      <Wordmark as="p" className="mb-10 text-[34px]" />
      <LoginFlow next={next} />
      <Link href="/about" className="text-ink-3 hover:text-ink mt-auto w-fit pt-10 text-[13px] underline-offset-4 hover:underline sm:mt-12">
        {t("about.link")}
      </Link>
    </main>
  );
}
