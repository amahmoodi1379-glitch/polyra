import type { MetadataRoute } from "next";
import { t } from "@/i18n";

/** The app on the phone's home screen (PRD §15.6 «PWA»): opens on the learner's home, full screen, right to left. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "polyra",
    short_name: "polyra",
    description: t("app.description"),
    lang: "fa",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFF6F9",
    theme_color: "#FFF6F9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
