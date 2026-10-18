import "./controls.css";

/**
 * The spectrum progress bar. `live` adds the slow sheen used while files are
 * being read; leave `value` out for the indeterminate slide.
 */
export function Bar({ value, label, live, style }: { value?: number; label: string; live?: boolean; style?: React.CSSProperties }) {
  const known = value !== undefined;
  return (
    <div
      className={`bar${live ? " live" : ""}${known ? "" : " indeterminate"}`}
      style={style}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(value) : undefined}
    >
      <i style={known ? { width: `${Math.max(1.5, Math.min(100, value))}%` } : undefined} />
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return <span className="spinner" role="progressbar" aria-label={label} />;
}
