import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import "./controls.css";

export interface MenuItem {
  label: string;
  icon: IconName;
  shortcut?: string;
  run: () => void;
}

/**
 * WinUI MenuFlyout. Takes focus while open: arrows move, Enter runs, Esc or
 * clicking outside closes, and focus returns to whatever had it before.
 */
export function Menu({
  items,
  style,
  onClose,
  label,
}: {
  items: MenuItem[];
  style: React.CSSProperties;
  onClose: () => void;
  label: string;
}) {
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", outside);
    return () => {
      window.removeEventListener("mousedown", outside);
      previous?.focus();
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") setActive((i) => (i + 1) % items.length);
    else if (e.key === "ArrowUp") setActive((i) => (i - 1 + items.length) % items.length);
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(items.length - 1);
    else if (e.key === "Enter" || e.key === " ") {
      onClose();
      items[active].run();
    } else if (e.key === "Escape" || e.key === "Tab" || (e.ctrlKey && e.key.toLowerCase() === "k")) onClose();
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={root}
      className="menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={style}
      aria-activedescendant={`menu-item-${active}`}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          id={`menu-item-${i}`}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="menu-item"
          data-active={i === active}
          onMouseEnter={() => setActive(i)}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <Icon name={item.icon} size={16} />
          <span className="menu-item-label">{item.label}</span>
          {item.shortcut && <span className="menu-item-key">{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}
