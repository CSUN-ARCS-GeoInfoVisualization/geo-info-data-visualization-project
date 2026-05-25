import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface CenteredInfoCardProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Optional colored stripe across the header — pass a tailwind bg-* class. */
  accent?: string;
  children: ReactNode;
  /** Max width override (default ~480px). */
  width?: string;
}

/**
 * Single source of truth for map-driven info popups across the site.
 * Renders into a portal at the document body so it always escapes the map
 * container's clipping. Click the scrim, press ESC, or hit X to close.
 *
 * Why this exists: deck.gl click anchors landed popups near the edge of
 * the viewport, sometimes clipping the close button entirely. A centered
 * fixed-position card is reachable from anywhere on the map.
 */
export function CenteredInfoCard({
  open,
  onClose,
  title,
  subtitle,
  accent,
  children,
  width = "max-w-[480px]",
}: CenteredInfoCardProps) {
  // ESC closes the card. Effect runs only while open so we don't leak listeners.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    // Inline styles so a parent's `transform`, `filter`, or Tailwind purge
    // can't change positioning — earlier the card was rendering at the
    // bottom of the page on the Shelters & Evac map because `fixed inset-0`
    // was getting overridden somehow.
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0, left: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 16px',
      }}
    >
      {/* Scrim */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0, left: 0,
          background: 'rgba(0, 0, 0, 0.35)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Card */}
      <div
        className={`relative w-full ${width} bg-white rounded-xl shadow-2xl overflow-hidden border border-zinc-200 max-h-[85vh] flex flex-col`}
        style={{ position: 'relative', zIndex: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        {accent && <div className={`h-1 w-full ${accent}`} />}

        {(title || subtitle) && (
          <div className="px-5 pt-4 pb-3 border-b border-zinc-100 flex items-start justify-between gap-3">
            <div className="min-w-0">
              {title && <div className="text-base font-semibold text-zinc-900 leading-tight">{title}</div>}
              {subtitle && <div className="mt-0.5 text-xs text-zinc-500">{subtitle}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mt-1 -mr-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* If no header, still expose a close button so users always have one. */}
        {!title && !subtitle && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-2 right-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/80 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 shadow-sm"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="px-5 py-4 overflow-y-auto text-sm text-zinc-700 leading-relaxed">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
