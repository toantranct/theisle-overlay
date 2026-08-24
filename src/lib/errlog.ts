// Global error capture -> the app's log file (%LOCALAPPDATA%\TheIsleOverlay\
// logs) and, when telemetry is on, the crash endpoint. Webviews have no
// devtools in the field, so without this every uncaught error and unhandled
// rejection simply vanishes.

import { error } from "@tauri-apps/plugin-log";
import { submitCrash } from "./api";

export function installGlobalErrorLog(label: string): void {
  window.addEventListener("error", (e) => {
    void error(`[${label}] ${e.message} @ ${e.filename}:${e.lineno}`).catch(() => {});
    // Rust caps this at 3 per process and 10 per day, so a render loop that
    // throws every frame cannot turn into a flood of requests.
    submitCrash(
      `[${label}] ${e.message}`,
      (e.error as Error | undefined)?.stack ?? `${e.filename}:${e.lineno}`,
    );
  });
  window.addEventListener("unhandledrejection", (e) => {
    void error(`[${label}] unhandled rejection: ${String(e.reason)}`).catch(() => {});
    submitCrash(
      `[${label}] unhandled rejection: ${String(e.reason)}`,
      (e.reason as Error | undefined)?.stack,
    );
  });
}
