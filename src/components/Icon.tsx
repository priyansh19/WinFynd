// WinFynd's line icons: a 20px grid with 1.5px round strokes, drawn to match
// the design. Glyphs pick up `currentColor`, so a kind class (.k-doc .kc)
// colours them like Windows 11 Settings colours its section icons.
const PATHS = {
  search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M12.5 12.5L17 17"/>',
  sparkle: '<path d="M9 2.5l1.7 4.8 4.8 1.7-4.8 1.7L9 15.5l-1.7-4.8L2.5 9l4.8-1.7z"/><path d="M15.5 13.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
  mic: '<rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/>',
  folder: '<path d="M2.5 5.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/>',
  folderAdd: '<path d="M2.5 5.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v3M9.5 16.5h-6a1 1 0 0 1-1-1v-10"/><path d="M15 12.5v5M12.5 15h5"/>',
  home: '<path d="M3 9l7-6 7 6v7.5a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1z"/>',
  cube: '<path d="M10 2.5l7 3.8v7.4l-7 3.8-7-3.8V6.3z"/><path d="M3 6.3l7 3.9 7-3.9M10 10.2v7.3"/>',
  keyboard: '<rect x="2" y="5" width="16" height="10" rx="1.5"/><path d="M5 8h.01M8 8h.01M11 8h.01M14 8h.01M5 11h.01M15 11h.01M8 12h4"/>',
  shield: '<path d="M10 2.5l6 2.5v4.5c0 4-2.7 6.6-6 8-3.3-1.4-6-4-6-8V5z"/><path d="M7.5 10l1.8 1.8 3.4-3.6"/>',
  info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5M10 6.2v.1"/>',
  refresh: '<path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.5h-3.5"/>',
  check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
  chevronDown: '<path d="M5.5 8l4.5 4.5L14.5 8"/>',
  chevronRight: '<path d="M8 5.5l4.5 4.5L8 14.5"/>',
  play: '<path d="M6.5 4.5v11l9-5.5z" fill="currentColor"/>',
  pause: '<path d="M7 5v10M13 5v10"/>',
  open: '<path d="M11.5 3.5h5v5M16.5 3.5l-7 7M14 11.5v4a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
  copy: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M13 7V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3"/>',
  minimize: '<path d="M5 10h10"/>',
  maximize: '<rect x="5.5" y="5.5" width="9" height="9" rx="1.5"/>',
  restore: '<rect x="5" y="7" width="8" height="8" rx="1.5"/><path d="M7.5 7V6a1 1 0 0 1 1-1H14a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-1"/>',
  close: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
  bell: '<path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13zM8 17.5h4"/>',
  globe: '<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.2 2.2 12.8 0 15M10 2.5c-2.2 2.2-2.2 12.8 0 15"/>',
  trash: '<path d="M3.5 5.5h13M8 5.5V3.5h4v2M5.5 5.5l.8 11a1 1 0 0 0 1 1h5.4a1 1 0 0 0 1-1l.8-11"/>',
  lock: '<rect x="4" y="9" width="12" height="8.5" rx="1.5"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"/>',
  download: '<path d="M10 3v10M5.5 8.5L10 13l4.5-4.5M4 16.5h12"/>',
  photo: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><circle cx="7" cy="8" r="1.5"/><path d="M2.5 14l4.5-4 4 3.5 2.5-2 4 3.5"/>',
  wave: '<path d="M3 10h1M6 7v6M9 4v12M12 6.5v7M15 8.5v3M17 10h.5"/>',
  video: '<rect x="2.5" y="5" width="11" height="10" rx="1.5"/><path d="M13.5 9l4-2.5v7l-4-2.5"/>',
  doc: '<path d="M5.5 2.5h6l4 4v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z"/><path d="M11.5 2.5v4h4M7.5 10.5h5M7.5 13.5h5"/>',
  gear: '<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  bolt: '<path d="M11 2.5L4.5 11h5l-1 6.5L15.5 9h-5z"/>',
  clock: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/>',
  tray: '<path d="M2.5 11.5l2-7h11l2 7v4a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/><path d="M2.5 11.5h4l1 2h5l1-2h4"/>',
  warning: '<path d="M10 3l7.5 13.5h-15z"/><path d="M10 8.5v3.5M10 14.3v.1"/>',
  error: '<circle cx="10" cy="10" r="7.5"/><path d="M10 6v5M10 13.8v.1"/>',
  more: '<path d="M5 10h.01M10 10h.01M15 10h.01" stroke-width="2.2"/>',
  cloud: '<path d="M6 15.5a3.5 3.5 0 0 1-.4-7A5 5 0 0 1 15 7.6a4 4 0 0 1-.5 7.9z"/>',
  github: '<path d="M7.5 16.5c-3.5 1-3.5-1.8-5-2.2M12.5 18v-2.6a2.3 2.3 0 0 0-.6-1.7c2-.2 4.1-1 4.1-4.5a3.5 3.5 0 0 0-1-2.4 3.2 3.2 0 0 0-.1-2.4s-.8-.2-2.5 1a8.6 8.6 0 0 0-4.6 0C6.1 4.2 5.3 4.4 5.3 4.4a3.2 3.2 0 0 0-.1 2.4 3.5 3.5 0 0 0-1 2.4c0 3.5 2.1 4.3 4.1 4.5a2.3 2.3 0 0 0-.6 1.7V18"/>',
  heart: '<path d="M10 16.5s-6.5-3.8-6.5-8.3A3.5 3.5 0 0 1 10 6.3a3.5 3.5 0 0 1 6.5 1.9c0 4.5-6.5 8.3-6.5 8.3z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.5,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={{ flex: "none", ...style }}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

/** The WinFynd mark: a magnifier with a spark, on the spectrum tile (or inverted, white). */
export function AppIcon({ size = 18, inverse = false }: { size?: number; inverse?: boolean }) {
  const id = `wfg${inverse ? "i" : ""}${size}`;
  const tile = inverse ? "#ffffff" : `url(#${id})`;
  const ink = inverse ? `url(#${id})` : "#ffffff";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" style={{ flex: "none" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b9bff" />
          <stop offset=".45" stopColor="#9a7bff" />
          <stop offset=".75" stopColor="#ff6fb5" />
          <stop offset="1" stopColor="#ff9548" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill={tile} />
      <circle cx="21" cy="21" r="10" fill="none" stroke={ink} strokeWidth="4" />
      <path d="M28.5 28.5l8 8" stroke={ink} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M21 15.5l1.4 3.8 3.8 1.4-3.8 1.4L21 26l-1.4-3.9-3.8-1.4 3.8-1.4z" fill={ink} />
    </svg>
  );
}
