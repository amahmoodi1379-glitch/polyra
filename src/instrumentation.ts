import type { Instrumentation } from "next";

/** Every server error the app does not catch itself goes to `error_log` (PRD §15.9). */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // The check is replaced at build time, so the database code stays out of the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recordRequestError } = await import("@/server/request-error");
    await recordRequestError(error, request.headers, context);
  }
};
