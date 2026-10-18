import { Icon } from "./Icon";
import "./controls.css";

/** WinUI ToggleSwitch, with the On/Off label Windows Settings shows beside it. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="toggle"
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-state" aria-hidden="true">
        {checked ? "On" : "Off"}
      </span>
      <span className="toggle-track">
        <span className="toggle-knob" />
      </span>
    </button>
  );
}

/** WinUI ComboBox over a native select, so keyboard and screen readers work as usual. */
export function ComboBox<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
  width,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
  width?: number;
}) {
  return (
    <span className="combo" style={width ? { minWidth: width, width } : undefined}>
      <select
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={16} />
    </span>
  );
}
