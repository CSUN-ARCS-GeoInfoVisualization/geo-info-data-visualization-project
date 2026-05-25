import { ShieldAlert, Flame, Home, Building2 } from "lucide-react";

/**
 * Shared legend for any page that renders FireScope shelter + evacuation
 * imagery (Shelters & Evacuation, Research page). Single source of visual
 * truth so the same colors / icons mean the same thing everywhere.
 *
 * Pass `variant="compact"` for the dashboard sidebar; default is the full
 * card used on the actual map pages.
 */
interface ShelterEvacLegendProps {
  variant?: "default" | "compact";
  showShelters?: boolean;
  showEvacZones?: boolean;
}

const SHELTER_ICON_OPEN = "#16a34a";    // green-600
const SHELTER_ICON_CLOSED = "#9ca3af";  // zinc-400
const EVAC_ORDER = "#7f1d1d";           // red-900
const EVAC_WARNING = "#d97706";         // amber-600
const EVAC_ADVISORY = "#eab308";        // yellow-500

export function ShelterEvacLegend({
  variant = "default",
  showShelters = true,
  showEvacZones = true,
}: ShelterEvacLegendProps) {
  const compact = variant === "compact";

  return (
    <div
      className={
        compact
          ? "text-xs text-zinc-700 space-y-1"
          : "bg-white/95 border border-zinc-200 rounded-lg shadow-sm p-3 text-xs text-zinc-700 space-y-2 max-w-[220px]"
      }
    >
      {!compact && <div className="font-semibold text-zinc-900 text-[11px] uppercase tracking-wide">Legend</div>}

      {showEvacZones && (
        <div className={compact ? "" : "space-y-1.5"}>
          {!compact && <div className="font-medium text-zinc-600">Evacuation zones</div>}
          <LegendRow swatchColor={EVAC_ORDER}    icon={<ShieldAlert className="h-3 w-3 text-white" />} label="Order (mandatory)" />
          <LegendRow swatchColor={EVAC_WARNING}  icon={<ShieldAlert className="h-3 w-3 text-white" />} label="Warning (prepare)" />
          <LegendRow swatchColor={EVAC_ADVISORY} icon={<ShieldAlert className="h-3 w-3 text-white" />} label="Advisory / shelter-in-place" />
        </div>
      )}

      {showShelters && (
        <div className={compact ? "" : "space-y-1.5"}>
          {!compact && <div className="font-medium text-zinc-600">Shelters</div>}
          <LegendRow swatchColor={SHELTER_ICON_OPEN}   icon={<Home className="h-3 w-3 text-white" />}      label="Open" />
          <LegendRow swatchColor={SHELTER_ICON_CLOSED} icon={<Home className="h-3 w-3 text-white" />}      label="Closed / not active" />
          {!compact && <LegendRow swatchColor="#dc2626" icon={<Flame className="h-3 w-3 text-white" />}    label="Active fire perimeter" />}
          {!compact && <LegendRow swatchColor="#374151" icon={<Building2 className="h-3 w-3 text-white" />} label="Other facility" />}
        </div>
      )}
    </div>
  );
}

function LegendRow({ swatchColor, icon, label }: { swatchColor: string; icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-sm shrink-0"
        style={{ background: swatchColor }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="text-zinc-700">{label}</span>
    </div>
  );
}

/** Color constants exported so layer code stays in sync with the legend. */
export const SHELTER_EVAC_COLORS = {
  SHELTER_ICON_OPEN,
  SHELTER_ICON_CLOSED,
  EVAC_ORDER,
  EVAC_WARNING,
  EVAC_ADVISORY,
} as const;
