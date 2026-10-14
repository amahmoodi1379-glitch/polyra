import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "@fontsource-variable/fraunces/full.css";
import "./globals.css";
import { DirectionProvider } from "@/components/direction";
import { defaultLocale, locales, t } from "@/i18n";
import { themeScript } from "@/lib/theme-script";

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
    // The theme script may set data-theme before React hydrates.
    <html lang={locale.lang} dir={locale.dir} suppressHydrationWarning>
      <head>
        {/* Runs once while the page is parsed; the client keeps it inert so React does not warn (Next.js «Preventing Flash»). */}
        <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <DirectionProvider dir={locale.dir}>{children}</DirectionProvider>
      </body>
    </html>
  );
}
