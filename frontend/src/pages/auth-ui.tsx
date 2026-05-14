import { ReactNode } from "react";
import { Link } from "react-router-dom";

export function AuthShell({ title, subtitle, children, foot }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  foot: ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-12 bg-page">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block font-bold text-lg tracking-tight">
            Stravify<span className="text-brand">.</span>
          </Link>
        </div>
        <div className="bg-card border border-line rounded-md p-7">
          <h1 className="text-2xl font-bold tracking-tight mb-1">{title}</h1>
          {subtitle && <p className="text-sm text-muted mb-6">{subtitle}</p>}
          {!subtitle && <div className="mb-6" />}
          {children}
        </div>
        <div className="text-center mt-5 text-sm text-muted">{foot}</div>
      </div>
    </div>
  );
}

export function Field({
  label, hint, ...props
}: {
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block mb-4">
      <span className="block text-xs font-medium text-muted mb-1.5">{label}</span>
      <input
        {...props}
        className="w-full bg-card-2 border border-line-strong rounded px-3 py-2.5 text-sm text-fg outline-none focus:border-brand placeholder:text-dim"
      />
      {hint && <span className="block text-xs text-dim mt-1.5">{hint}</span>}
    </label>
  );
}

export function SubmitButton({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full bg-brand hover:bg-brand-hover text-black font-semibold py-2.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed mt-2"
    >
      {busy ? busyLabel : label}
    </button>
  );
}

export function ErrorMsg({ children }: { children: ReactNode }) {
  return <div className="text-danger text-sm mb-3">{children}</div>;
}
export function InfoMsg({ children }: { children: ReactNode }) {
  return <div className="text-brand text-sm mb-3">{children}</div>;
}
