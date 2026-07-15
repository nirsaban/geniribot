import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3 animate-fade-up">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card-p animate-fade-up ${className}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
  icon,
  accent = "brand",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  accent?: "brand" | "amber" | "slate" | "green";
}) {
  const accents: Record<string, string> = {
    brand: "bg-brand/10 text-brand-dark",
    amber: "bg-amber-100 text-amber-700",
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-50 text-emerald-700",
  };
  return (
    <div className="card lift animate-pop p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        {icon && <span className={`rounded-lg p-1.5 text-lg ${accents[accent]}`}>{icon}</span>}
      </div>
      <div className="mt-2 text-3xl font-bold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  icon = "✨",
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-10 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="text-lg font-semibold text-ink">{title}</div>
      {body && <p className="max-w-sm text-sm text-slate-500">{body}</p>}
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: "brand" | "gray" | "green" | "amber" | "red";
}) {
  return <span className={`badge-${tone}`}>{children}</span>;
}

export function LinkButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <Link href={href} className={`btn-${variant}`}>
      {children}
    </Link>
  );
}
