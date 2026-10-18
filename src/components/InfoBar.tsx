import type { ReactNode } from "react";
import { Icon } from "./Icon";
import "./controls.css";

type Severity = "info" | "success" | "warning" | "error";
const ICON = { info: "info", success: "success", warning: "warning", error: "error" } as const;

/** WinUI InfoBar: an inline, persistent status message with an optional action. */
export function InfoBar({
  severity = "info",
  title,
  children,
  action,
}: {
  severity?: Severity;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`infobar infobar-${severity}`} role={severity === "error" || severity === "warning" ? "alert" : "status"}>
      <Icon name={ICON[severity]} size={16} className="infobar-icon" />
      <div className="infobar-text">
        <span className="infobar-title">{title}</span>
        {children && <span>{children}</span>}
      </div>
      {action && <div className="infobar-action">{action}</div>}
    </div>
  );
}
