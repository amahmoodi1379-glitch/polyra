import type { ReactNode } from "react";

/** Title and one line of explanation at the top of every panel page. */
export function PageHeader({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-ink text-2xl leading-tight font-extrabold">{title}</h1>
        {lead ? <p className="text-ink-2 max-w-[62ch]">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
