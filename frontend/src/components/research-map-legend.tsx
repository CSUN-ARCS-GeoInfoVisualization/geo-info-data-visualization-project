/**
 * Permanent legend for the Research page map. Morphs based on which
 * layers are currently visible: risk zone tiers, NIFC fire-perimeter
 * containment ramp, FIRMS heat intensity, shelter facility usage.
 *
 * Separate from <ShelterEvacLegend> because research has a wider layer
 * vocabulary and a much more fire-research-focused color palette.
 */
interface ResearchMapLegendProps {
  showZones: boolean;
  showPerimeters: boolean;
  showHeatmap: boolean;
  showShelters: boolean;
}

export function ResearchMapLegend({ showZones, showPerimeters, showHeatmap, showShelters }: ResearchMapLegendProps) {
  return (
    <div className="bg-white/95 border border-zinc-200 rounded-lg shadow-sm p-3 text-xs text-zinc-700 space-y-2.5 max-w-[230px]">
      <div className="font-semibold text-zinc-900 text-[11px] uppercase tracking-wide">Legend</div>

      {showZones && (
        <div className="space-y-1.5">
          <div className="font-medium text-zinc-600 text-[11px]">Risk zones</div>
          <Row color="rgb(220,38,38)"  label="Very High (≥0.66)" />
          <Row color="rgb(234,179,8)"  label="Moderate (0.33–0.66)" />
          <Row color="rgb(34,197,94)"  label="Low (&lt;0.33)" />
        </div>
      )}

      {showPerimeters && (
        <div className="space-y-1.5">
          <div className="font-medium text-zinc-600 text-[11px]">Fire perimeter (NIFC)</div>
          <Row color="rgb(220,38,38)"  label="Uncontained (&lt;25%)" />
          <Row color="rgb(249,115,22)" label="25–49% contained" />
          <Row color="rgb(250,204,21)" label="50–99% contained" />
          <Row color="rgb(229,231,235)" border="rgb(180,180,180)" label="Contained (≥100%)" />
        </div>
      )}

      {showHeatmap && (
        <div className="space-y-1.5">
          <div className="font-medium text-zinc-600 text-[11px]">FIRMS hotspots</div>
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 rounded" style={{ background: 'linear-gradient(to right, rgb(34,197,94), rgb(234,179,8), rgb(234,88,12), rgb(220,38,38), rgb(153,27,27))' }} />
          </div>
          <div className="flex justify-between text-[10px] text-zinc-500">
            <span>low</span><span>high</span>
          </div>
        </div>
      )}

      {showShelters && (
        <div className="space-y-1.5">
          <div className="font-medium text-zinc-600 text-[11px]">Shelters (by use)</div>
          <Row color="rgb(59,130,246)"  label="Evacuation (EVAC)" />
          <Row color="rgb(34,197,94)"   label="Post-impact (POST)" />
          <Row color="rgb(147,51,234)"  label="Both" />
          <Row color="rgb(156,163,175)" label="Other facility" />
        </div>
      )}
    </div>
  );
}

function Row({ color, label, border }: { color: string; label: React.ReactNode; border?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-3 w-3 rounded shrink-0"
        style={{ background: color, border: border ? `1px solid ${border}` : undefined }}
        aria-hidden="true"
      />
      <span className="text-zinc-700">{label}</span>
    </div>
  );
}
