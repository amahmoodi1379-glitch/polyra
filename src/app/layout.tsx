import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "@fontsource-variable/fraunces/full.css";
import "./globals.css";
import { defaultLocale, locales, t } from "@/i18n";

export const metadata: Metadata = {
  title: { default: "polyra", template: "%s · polyra" },
  description: t("app.description"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF6F9" },
    { media: "(prefers-color-scheme: dark)", color: "#2B1020" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const locale = locales[defaultLocale];
  return (
    <html lang={locale.lang} dir={locale.dir}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
