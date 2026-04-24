import type { ReactNode } from 'react';

export function Section({
  number,
  title,
  hint,
  children,
}: {
  number: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border py-6 first:pt-0">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-[11px] font-mono text-text-tertiary">{number}</span>
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <span className="text-[11px] text-text-tertiary ml-auto">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-xs font-medium text-text-secondary">{label}</label>
        {hint && <span className="text-[11px] text-text-tertiary">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
