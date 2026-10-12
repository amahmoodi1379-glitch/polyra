import { t } from "@/i18n";

const tehran = "Asia/Tehran";

/** 21 مهر ۱۴۰۵، ۱۴:۳۰ — Persian calendar, Tehran time. */
export function formatDateTimeFa(date: Date): string {
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: tehran,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** «همین الان», «۳ دقیقه پیش», «۲ ساعت پیش», then the date. */
export function formatAgoFa(date: Date, now: Date): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("fa-IR", { numeric: "auto" });
  if (seconds < 60) return t("common.justNow");
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return rtf.format(-Math.floor(seconds / 3600), "hour");
  return formatDateTimeFa(date);
}
