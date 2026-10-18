import "./controls.css";

/** WinUI ProgressBar; leave `value` out for the indeterminate animation. */
export function ProgressBar({ value, label }: { value?: number; label: string }) {
  const known = value !== undefined;
  return (
    <div
      className={known ? "progress" : "progress progress-indeterminate"}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(value) : undefined}
    >
      <div className="progress-fill" style={known ? { width: `${Math.max(2, Math.min(100, value))}%` } : undefined} />
    </div>
  );
}

export function ProgressRing({ label }: { label: string }) {
  return <span className="ring" role="progressbar" aria-label={label} />;
}
