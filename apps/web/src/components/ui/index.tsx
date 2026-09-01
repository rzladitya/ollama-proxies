import type { ReactNode } from "react";

// ── Task 065: PageHeader ──
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[var(--color-border)]">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

// ── Task 066: MetricCard ──
export function MetricCard({
  label,
  value,
  secondary,
  trend,
}: {
  label: string;
  value: string | number;
  secondary?: string;
  trend?: { direction: "up" | "down" | "neutral"; text: string };
}) {
  return (
    <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-xl p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="text-3xl font-semibold mt-2 text-[var(--color-text-primary)] font-mono">
        {value}
      </div>
      {(secondary || trend) && (
        <div className="flex items-center gap-2 mt-2 text-xs text-[var(--color-text-secondary)]">
          {trend && (
            <span
              className={
                trend.direction === "up"
                  ? "text-[var(--color-success)]"
                  : trend.direction === "down"
                  ? "text-[var(--color-danger)]"
                  : "text-[var(--color-text-muted)]"
              }
            >
              {trend.text}
            </span>
          )}
          {secondary && <span>{secondary}</span>}
        </div>
      )}
    </div>
  );
}

// ── Task 067 & 077: Badges ──
export function Badge({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: "success" | "warning" | "danger" | "degraded" | "info" | "neutral" | "accent";
}) {
  const styles = {
    success: "bg-[var(--color-success-bg)] text-[var(--color-success)] border-[var(--color-success)]/30",
    warning: "bg-[var(--color-warning-bg)] text-[var(--color-warning)] border-[var(--color-warning)]/30",
    danger: "bg-[var(--color-danger-bg)] text-[var(--color-danger)] border-[var(--color-danger)]/30",
    degraded: "bg-[var(--color-degraded-bg)] text-[var(--color-degraded)] border-[var(--color-degraded)]/30",
    info: "bg-[var(--color-info-bg)] text-[var(--color-info)] border-[var(--color-info)]/30",
    neutral: "bg-neutral-800/60 text-neutral-300 border-neutral-700/50",
    accent: "bg-[var(--color-accent-bg)] text-[var(--color-accent)] border-[var(--color-accent)]/30",
  }[variant];

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles}`}>
      {children}
    </span>
  );
}

export function AccountStatusBadge({
  state,
}: {
  state: "ACTIVE" | "DEGRADED" | "COOLDOWN" | "INVALID" | "DISABLED";
}) {
  const map: Record<string, { label: string; variant: "success" | "degraded" | "warning" | "danger" | "neutral" }> = {
    ACTIVE: { label: "Active", variant: "success" },
    DEGRADED: { label: "Degraded", variant: "degraded" },
    COOLDOWN: { label: "Cooldown", variant: "warning" },
    INVALID: { label: "Invalid Auth", variant: "danger" },
    DISABLED: { label: "Disabled", variant: "neutral" },
  };
  const config = map[state] || { label: state, variant: "neutral" };
  return (
    <Badge variant={config.variant}>
      <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-current" />
      {config.label}
    </Badge>
  );
}

// ── Task 070: Button ──
export function Button({
  children,
  variant = "primary",
  size = "md",
  disabled,
  loading,
  onClick,
  type = "button",
  className = "",
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  className?: string;
  title?: string;
}) {
  const sizeStyles = {
    sm: "px-2.5 py-1 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-5 py-2.5 text-base",
  }[size];

  const variantStyles = {
    primary:
      "bg-[var(--color-accent)] text-black font-semibold hover:bg-[var(--color-accent-hover)] active:scale-[0.98] shadow-sm",
    secondary:
      "bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-neutral-800 active:scale-[0.98]",
    ghost:
      "bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5",
    danger:
      "bg-[var(--color-danger-bg)] text-[var(--color-danger)] border border-[var(--color-danger)]/30 hover:bg-[var(--color-danger)]/20 active:scale-[0.98]",
  }[variant];

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50 disabled:opacity-50 disabled:cursor-not-allowed ${sizeStyles} ${variantStyles} ${className}`}
    >
      {loading ? (
        <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
      ) : null}
      {children}
    </button>
  );
}

// ── Task 071: Form Controls ──
export function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
  description,
  error,
}: {
  label?: string;
  value: string | number;
  onChange: (val: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  description?: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-xs font-medium text-[var(--color-text-secondary)]">
          {label} {required && <span className="text-[var(--color-danger)]">*</span>}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={`w-full px-3 py-2 bg-[var(--color-bg-canvas)] border rounded-lg text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] transition-colors ${
          error ? "border-[var(--color-danger)]" : "border-[var(--color-border)]"
        }`}
      />
      {description && <span className="text-xs text-[var(--color-text-muted)]">{description}</span>}
      {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
    </div>
  );
}

// ── Task 074: CodeValue & CopyButton ──
export function CodeValue({ value }: { value: string }) {
  return (
    <code className="px-2 py-0.5 bg-[var(--color-bg-canvas)] border border-[var(--color-border)] rounded text-xs font-mono text-[var(--color-text-primary)] select-all">
      {value}
    </code>
  );
}

// ── Task 072: Modal ──
export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-[var(--color-border)]">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h2>
          {description && <p className="text-sm text-[var(--color-text-secondary)] mt-1">{description}</p>}
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="p-4 bg-[var(--color-bg-canvas)] border-t border-[var(--color-border)] flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

// ── Task 075: EmptyState & InlineAlert ──
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-12 border border-dashed border-[var(--color-border)] rounded-2xl bg-[var(--color-bg-surface)]/50">
      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h3>
      {description && <p className="text-sm text-[var(--color-text-secondary)] mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function InlineAlert({
  type = "info",
  title,
  children,
}: {
  type?: "info" | "warning" | "error" | "success";
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    info: "bg-[var(--color-info-bg)] border-[var(--color-info)]/30 text-blue-200",
    warning: "bg-[var(--color-warning-bg)] border-[var(--color-warning)]/30 text-amber-200",
    error: "bg-[var(--color-danger-bg)] border-[var(--color-danger)]/30 text-red-200",
    success: "bg-[var(--color-success-bg)] border-[var(--color-success)]/30 text-emerald-200",
  }[type];

  return (
    <div className={`p-4 rounded-xl border text-sm ${styles}`}>
      {title && <div className="font-semibold mb-1">{title}</div>}
      <div>{children}</div>
    </div>
  );
}
