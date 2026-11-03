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
  const query = await searchParams;
  const next = safeNext(query.next);
  if (await getCurrentUser()) redirect(next);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col px-5 pt-[max(12vh,48px)] pb-10 sm:justify-center sm:pt-10 sm:pb-[14vh]">
      <Wordmark as="p" className="mb-10 text-[34px]" />
      {query.deleted === "1" ? (
        <p role="status" className="bg-tint text-ink mb-8 rounded-[18px] px-4 py-3 text-[14px] leading-7 font-bold" data-deleted>
          {t("login.deleted")}
        </p>
      ) : null}
      <LoginFlow next={next} />
      <p className="text-ink-3 mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-10 text-[13px] sm:mt-12">
        <Link href="/about" className="hover:text-ink w-fit underline-offset-4 hover:underline">
          {t("about.link")}
        </Link>
        <Link href="/terms" className="hover:text-ink w-fit underline-offset-4 hover:underline">
          {t("terms.title")}
        </Link>
      </p>
    </main>
  );
}
