/**
 * Shared full map legend. Single source of truth for the
 * "Shelter Cluster + Emergency Shelter Types + Active Evacuation Zones +
 * Active Fires" key. Rendered below the map on every page that displays
 * these layers so the icons, colors, and copy stay identical across pages.
 *
 * Extracted from the original inline block in evacuation-routes.tsx so the
 * research page (and any future page) renders the exact same UI.
 */
interface MapLegendProps {
  /** Toggle the "How to use" footer line — only useful on the user-facing
   * Shelters & Evac page; the research page hides it. */
  showHowTo?: boolean;
  /** Toggle the cluster row — shown on Shelters & Evac (clustered icons),
   * hidden on research (individual pins, no clustering). */
  showCluster?: boolean;
}

export function MapLegend({ showHowTo = true, showCluster = true }: MapLegendProps) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <h4 className="font-semibold text-base mb-3">Map Legend</h4>

      {/* Clustering explanation */}
      {showCluster && (
        <div className="mb-4 pb-4 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm">
              25
            </div>
            <div className="text-sm">
              <div className="font-semibold">Shelter Cluster</div>
              <div className="text-muted-foreground">Click to zoom in and expand</div>
            </div>
          </div>
        </div>
      )}

      {/* Shelter types */}
      <div className="space-y-2">
        <div className="text-base font-semibold text-muted-foreground mb-2">Emergency Shelter Types:</div>

        <div className="grid grid-cols-1 gap-2 text-base">
          {/* Evacuation Shelters */}
          <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-100">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgb(59, 130, 246)' }}>
              <span className="text-base">🏃</span>
            </div>
            <div>
              <div><strong>Evacuation Shelter</strong></div>
              <div className="text-xs text-muted-foreground">Pre-disaster evacuation only</div>
            </div>
          </div>

          {/* Post-Impact Shelters */}
          <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-100">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgb(34, 197, 94)' }}>
              <span className="text-base">🏠</span>
            </div>
            <div>
              <div><strong>Post-Impact Shelter</strong></div>
              <div className="text-xs text-muted-foreground">After disaster relief</div>
            </div>
          </div>

          {/* Both */}
          <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-100">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgb(147, 51, 234)' }}>
              <span className="text-base">🏛️</span>
            </div>
            <div>
              <div><strong>Dual-Purpose Shelter</strong></div>
              <div className="text-xs text-muted-foreground">Both evacuation & post-impact</div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Evacuation Zones */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="text-base font-semibold text-muted-foreground mb-2">Active Evacuation Zones — Statewide CA</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded" style={{ backgroundColor: 'rgba(220,38,38,0.55)', border: '1.5px solid #dc2626' }} /> Order</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded" style={{ backgroundColor: 'rgba(249,115,22,0.55)', border: '1.5px solid #f97316' }} /> Warning</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded" style={{ backgroundColor: 'rgba(250,204,21,0.55)', border: '1.5px solid #facc15' }} /> Advisory</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded" style={{ backgroundColor: 'rgba(147,51,234,0.55)', border: '1.5px solid #9333ea' }} /> Shelter in Place</div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Statewide evacuation polygons aggregated by Cal OES from county sheriffs and Genasys PROTECT (the same source Watch Duty uses). Active zones only — cleared zones drop off automatically. Click a zone for status, county, and instructions.
        </p>
      </div>

      {/* Risk Zone tiers — matches dashboard's GoogleRiskMap polygon coloring */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="text-base font-semibold text-muted-foreground mb-2">Risk Zones (model tier)</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded border border-gray-300" style={{ backgroundColor: 'rgba(34,197,94,0.55)' }} /> Low</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded border border-gray-300" style={{ backgroundColor: 'rgba(234,179,8,0.65)' }} /> Medium</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded border border-gray-300" style={{ backgroundColor: 'rgba(220,38,38,0.65)' }} /> High</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded border border-gray-300" style={{ backgroundColor: 'rgba(153,27,27,0.75)' }} /> Extreme</div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          ML-predicted risk per zone (county / ZIP / neighborhood / census tract). Shown on the dashboard map and on the research map's "Risk zone" or "Mixed" view. Click a zone polygon to see the model inputs that drove the score.
        </p>
      </div>

      {/* Active Fire Perimeters */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="text-base font-semibold text-muted-foreground mb-2">Active Fires — Avoid These Areas</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded border border-gray-300" style={{ backgroundColor: '#dc2626' }} /> 0–24% contained</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded border border-gray-300" style={{ backgroundColor: '#f97316' }} /> 25–49%</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded border border-gray-300" style={{ backgroundColor: '#facc15' }} /> 50–99%</div>
          <div className="flex items-center gap-2"><span className="inline-block w-4 h-3 rounded border border-gray-300" style={{ backgroundColor: '#2563eb' }} /> Your saved location</div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Fire perimeter polygons come from NIFC WFIGS (live California active fires, &lt;100% contained). Size + location reflect the real fire footprint — route around them.
        </p>
      </div>

      {/* Instructions */}
      {showHowTo && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <p className="text-sm text-muted-foreground">
            💡 <strong>How to use:</strong> Click blue clusters to zoom in. Click individual shelters to see capacity, accessibility, and amenities. Drag to pan, scroll to zoom. FEMA - National Shelter System Facilities
          </p>
        </div>
      )}
    </div>
  );
}
