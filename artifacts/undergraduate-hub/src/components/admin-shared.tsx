import type { ReactNode } from "react";

export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-accent">{eyebrow}</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}