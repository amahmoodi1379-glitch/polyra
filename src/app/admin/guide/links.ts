import type { MessageKey } from "@/i18n";

/** Pages the guide links with {{name}}. */
export const guidePages = {
  workbench: { href: "/admin", label: "admin.nav.workbench" },
  create: { href: "/admin/create", label: "admin.nav.create" },
  library: { href: "/admin/content", label: "admin.nav.library" },
  order: { href: "/admin/order", label: "admin.nav.order" },
  audio: { href: "/admin/audio", label: "admin.nav.audio" },
  publish: { href: "/admin/publish", label: "admin.nav.publish" },
  health: { href: "/admin/health", label: "admin.nav.health" },
  engine: { href: "/admin/settings/engine", label: "admin.nav.engine" },
  general: { href: "/admin/settings/general", label: "admin.nav.general" },
  log: { href: "/admin/log", label: "admin.nav.log" },
  errors: { href: "/admin/errors", label: "admin.nav.errors" },
  resolve: { href: "/admin/resolve", label: "admin.resolve.title" },
} satisfies Record<string, { href: string; label: MessageKey }>;
