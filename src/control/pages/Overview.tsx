export function OverviewPage() {
  return (
    <>
      <header className="cc-header">
        <h1>Overview</h1>
        <p>WinFynd runs in the background and indexes new files as they appear. Closing this window keeps it running in the tray.</p>
      </header>
      <div className="stat-grid">
        <Stat label="Items indexed" value="—" note="Appears once the indexer runs" />
        <Stat label="Watched folders" value="—" note="Documents, Pictures, Videos, Desktop" />
        <Stat label="Index size" value="—" note="Vectors + full-text" />
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card stat">
      <span className="cc-muted">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="cc-muted">{note}</span>
    </div>
  );
}
