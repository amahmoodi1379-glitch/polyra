"use client";

import "@fontsource-variable/vazirmatn";
import "@fontsource-variable/fraunces/full.css";
import "./globals.css";
import { ErrorScreen } from "@/components/error-screen";
import { defaultLocale, locales, t } from "@/i18n";

/** When the root layout itself fails, this replaces the whole page, so it brings its own document. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const locale = locales[defaultLocale];
  return (
    <html lang={locale.lang} dir={locale.dir}>
      <body className="min-h-dvh">
        <title>{t("errors.screen.title")}</title>
        <ErrorScreen error={error} retry={retry} place="app" />
      </body>
    </html>
  );
}
