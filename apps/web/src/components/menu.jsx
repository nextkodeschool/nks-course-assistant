import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

/**
 * A small overflow menu: one trigger, a short list of actions.
 *
 * Written rather than imported. It needs to open, close on outside click or
 * Escape, and carry the right ARIA roles -- about forty lines. A dropdown
 * library would bring positioning engines and portals for a menu that only
 * ever has two items.
 */
export function Menu({ label = "More options", items, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`menu ${className}`} ref={ref}>
      <button
        type="button"
        className="menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <MoreHorizontal size={15} strokeWidth={2} />
      </button>

      {open && (
        <div className="menu-pop" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.destructive ? "destructive" : ""}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
