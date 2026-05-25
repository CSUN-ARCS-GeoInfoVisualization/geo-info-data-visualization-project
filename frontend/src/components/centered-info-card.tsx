import { useEffect, type ReactNode } from "react";

interface CenteredInfoCardProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Optional colored stripe across the header — pass a tailwind bg-* class. */
  accent?: string;
  children: ReactNode;
  /** Max width override (default 340px to match the dashboard popup). */
  width?: string;
}

/**
 * Map info popup — same positioning pattern as the dashboard GoogleRiskMap:
 * absolute-positioned card anchored at the top-center of the nearest
 * positioned ancestor (the map container). No portal, no scrim, no overlay
 * blocking — just a small card hovering over the map.
 *
 * The parent must be `position: relative` (every map container in this
 * app already is, since deck.gl overlays require it).
 *
 * Was previously a portal-to-body fixed-position centered modal — that
 * pattern was confusing because it covered the whole viewport with a
 * scrim instead of just labeling the clicked feature.
 */
export function CenteredInfoCard({
  open,
  onClose,
  title,
  subtitle,
  accent,
  children,
  width = "340px",
}: CenteredInfoCardProps) {
  // ESC still closes the card.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      style={{
        position: "absolute",
        left: "50%",
        top: 12,
        transform: "translateX(-50%)",
        zIndex: 1000,
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        maxWidth: width,
        width: "calc(100% - 24px)",
        maxHeight: "calc(100% - 24px)",
        boxShadow:
          "0 10px 15px -3px rgba(0,0,0,0.15), 0 4px 6px -4px rgba(0,0,0,0.08)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {accent && <div className={accent} style={{ height: 4, width: "100%" }} />}

      {(title || subtitle) && (
        <div
          style={{
            padding: "12px 14px 10px",
            borderBottom: "1px solid #f1f5f9",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0, paddingRight: 6 }}>
            {title && (
              <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a", lineHeight: 1.25 }}>
                {title}
              </div>
            )}
            {subtitle && (
              <div style={{ marginTop: 2, fontSize: 11, color: "#64748b" }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              color: "#6b7280",
              padding: "2px 4px",
              marginTop: -2,
            }}
          >
            ×
          </button>
        </div>
      )}

      {!title && !subtitle && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            background: "rgba(255,255,255,0.9)",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            color: "#6b7280",
            zIndex: 2,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          ×
        </button>
      )}

      <div
        style={{
          padding: "12px 14px",
          overflowY: "auto",
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "#334155",
        }}
      >
        {children}
      </div>
    </div>
  );
}
