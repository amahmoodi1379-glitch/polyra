import { reportError } from "@/lib/report-error";

// Errors outside React's error screens (event handlers, timers, promises nobody waited for) go to
// `error_log` too (PRD §15.9). Reporting never throws, so it cannot break the page it watches.
try {
  window.addEventListener("error", (event) => void reportError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => void reportError(event.reason));
} catch {
  // A browser without these events still runs the app.
}
