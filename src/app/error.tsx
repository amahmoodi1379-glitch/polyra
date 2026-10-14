"use client";

import { ErrorScreen } from "@/components/error-screen";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} place="app" />;
}
