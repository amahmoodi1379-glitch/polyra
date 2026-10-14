"use client";

import { ErrorScreen } from "@/components/error-screen";

export default function AdminError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} place="admin" />;
}
