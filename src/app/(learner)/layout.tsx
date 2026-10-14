import "./learner.css";
import { IconSprite } from "@/components/learn/icons";
import { OutboxSync } from "@/components/learn/session/outbox";
import { ToastProvider } from "@/components/learn/toast";
import { defaultLocale, locales } from "@/i18n";

/** The learner app's frame (DESIGN.md): the icon sprite, the toast, the answer outbox and the styles of the Jelly world. */
export default function LearnerLayout({ children }: { children: React.ReactNode }) {
  const locale = locales[defaultLocale];
  return (
    <div className="lx" dir={locale.dir} lang={locale.lang}>
      <IconSprite />
      <ToastProvider>{children}</ToastProvider>
      <OutboxSync />
    </div>
  );
}
