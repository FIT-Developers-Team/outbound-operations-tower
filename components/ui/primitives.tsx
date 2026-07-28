import type { CSSProperties, ReactNode } from "react";
import type { AlertState, CheckerState, OrderStatus } from "@/lib/outbound-types";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  eyebrow,
  action,
  children,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card section ${className}`}>
      <header className="section-head">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone = "muted",
}: {
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone?: "normal" | "monitor" | "warning" | "critical" | "accent" | "teal" | "muted";
}) {
  const color =
    tone === "accent"
      ? "var(--accent)"
      : tone === "teal"
        ? "var(--teal)"
        : tone === "muted"
          ? "var(--text-muted)"
          : `var(--status-${tone})`;
  return (
    <article className="metric-card" style={{ "--metric-tone": color } as CSSProperties}>
      <span className="metric-label"><i />{label}</span>
      <strong className="metric-value num">{value}</strong>
      <span className="metric-sub">{sub}</span>
    </article>
  );
}

const statusTone: Record<OrderStatus, string> = {
  NEW: "monitor",
  ASSIGNED: "info",
  PICKING: "accent",
  PACKING: "warning",
  STAGING: "warning",
  LOADING: "accent",
  "READY TO SHIP": "teal",
  "ON DELIVERY": "teal",
  COMPLETED: "normal",
  HOLD: "critical",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge badge-${statusTone[status]}`}>{status}</span>;
}

export function AlertBadge({ state }: { state: AlertState }) {
  return <span className={`badge badge-${state.toLowerCase()}`}>{state}</span>;
}

export function CheckerBadge({ state }: { state: CheckerState }) {
  const tone =
    state === "DONE"
      ? "normal"
      : state === "IN PROGRESS"
        ? "accent"
        : state === "OVERDUE"
          ? "critical"
          : "monitor";
  return <span className={`badge badge-${tone}`}>{state}</span>;
}

export function ProgressBar({
  value,
  tone = "accent",
  label,
}: {
  value: number;
  tone?: "accent" | "teal" | "normal" | "warning" | "critical";
  label: string;
}) {
  return (
    <span
      aria-label={`${label}: ${Math.round(value)}%`}
      className="progress-track"
      role="img"
    >
      <i className={`progress-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}
