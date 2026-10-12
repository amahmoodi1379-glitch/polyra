import Link from "next/link";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { signOut } from "../admin/actions";

export default function NoAccessPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-6 px-5 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-ink text-[26px] leading-snug font-extrabold">{t("noAccess.title")}</h1>
        <p className="text-ink-2">{t("noAccess.body")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link href="/">{t("noAccess.home")}</Link>
        </Button>
        <form action={signOut}>
          <Button type="submit" variant="ghost">
            {t("noAccess.logout")}
          </Button>
        </form>
      </div>
    </main>
  );
}
