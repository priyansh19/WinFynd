import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** A row of Windows Settings: icon, header and description on the left, its control on the right. */
export function SettingsCard({
  icon,
  header,
  description,
  children,
  className,
}: {
  icon?: IconName;
  header: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`settings-card ${className ?? ""}`}>
      {icon && (
        <span className="settings-card-icon">
          <Icon name={icon} size={20} />
        </span>
      )}
      <div className="settings-card-text">
        <span className="settings-card-header">{header}</span>
        {description && <span className="settings-card-description">{description}</span>}
      </div>
      {children && <div className="settings-card-control">{children}</div>}
    </div>
  );
}
