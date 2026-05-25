import { useState, useEffect, useRef } from "react";
import {
  MapPin,
  Navigation,
  Shield,
  Phone,
  AlertTriangle,
  Car,
  Users,
  Clock,
  CheckCircle,
  ExternalLink
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Map, Marker, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { IconLayer, GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { CenteredInfoCard } from './centered-info-card';
import { ShelterEvacLegend, SHELTER_EVAC_COLORS } from './shelter-evac-legend';

// Defensive CA bounding box — drop any shelter point upstream may have
// included with a non-CA lat/lon. Catches feed bugs without trusting the
// `state` field alone.
const CA_BBOX = { latMin: 32.5, latMax: 42.0, lonMin: -124.5, lonMax: -114.1 };
const isInCA = (lat?: number, lon?: number) =>
  typeof lat === 'number' && typeof lon === 'number'
  && lat >= CA_BBOX.latMin && lat <= CA_BBOX.latMax
  && lon >= CA_BBOX.lonMin && lon <= CA_BBOX.lonMax;
import Supercluster from 'supercluster';
import { apiFetch } from '../services/api';
import { SavedLocationsOverlay } from './GoogleRiskMap';

const evacuationZones = [
  {
    id: "zone-a",
    name: "Zone A - High Risk",
    status: "mandatory",
    color: "bg-red-500",
    population: 2500,
    estimatedTime: "15 minutes",
    routes: ["Highway 101 North", "Mountain View Road"]
  },
  {
    id: "zone-b",
    name: "Zone B - Moderate Risk",
    status: "voluntary",
    color: "bg-orange-500",
    population: 4200,
    estimatedTime: "25 minutes",
    routes: ["Valley Road", "Oak Street"]
  },
  {
    id: "zone-c",
    name: "Zone C - Watch Area",
    status: "watch",
    color: "bg-yellow-500",
    population: 6800,
    estimatedTime: "30 minutes",
    routes: ["Main Street", "Pine Avenue"]
  }
];

const assemblyPoints = [
  {
    name: "Community Center",
    address: "123 Main St",
    capacity: 500,
    amenities: ["Food", "Water", "Medical"],
    distance: "2.1 miles"
  },
  {
    name: "High School Stadium",
    address: "456 Oak Ave",
    capacity: 1000,
    amenities: ["Food", "Water", "Medical", "Pet Care"],
    distance: "3.5 miles"
  },
  {
    name: "County Fairgrounds",
    address: "789 Valley Rd",
    capacity: 2000,
    amenities: ["Food", "Water", "Medical", "Pet Care", "Shelter"],
    distance: "5.8 miles"
  }
];

const safetyChecklist = {
  prepare: [
    "Create a family evacuation plan",
    "Register for local emergency alert notifications",
    "Photograph home and belongings for insurance records",
    "Clear dry vegetation within 30 feet of the home",
    "Install spark arrestors and clean roof/gutters",
    "Prepare a go-bag (medications, water, flashlight, chargers)",
    "Scan and store important documents digitally",
    "Plan evacuation meeting location outside the fire zone",
    "Plan evacuation for pets and livestock"
  ],
  fireWatch: [
    "Park vehicle facing outward in driveway",
    "Keep fuel tank at least half full",
    "Move flammable furniture away from windows",
    "Bring pets indoors and prepare carriers",
    "Charge phones and backup batteries",
    "Place go-bags near exit",
    "Monitor official fire updates"
  ],
  evacuationWarning: [
    "Wear protective clothing (long sleeves, sturdy shoes)",
    "Shut all windows and doors but leave unlocked",
    "Turn off gas at the meter if instructed",
    "Turn on exterior lights for visibility in smoke",
    "Leave sprinklers off unless directed",
    "Load family, pets, and essential items into vehicle",
    "Notify family meeting contact you are leaving"
  ],
  evacuateNow: [
    "Leave immediately — do not wait for belongings",
    "Follow designated evacuation routes only",
    "Do not drive toward smoke or flames",
    "Keep headlights on while driving",
    "Listen to emergency radio for updates",
    "Check in as safe with emergency contact"
  ]
};

// Deck.gl overlay component with clustering
function FireFacilitiesOverlay({
  smallDots = false,
  onRouteTo,
  showFires = true,
  showEvacZones = true,
  onZonesLoaded,
  fitBoundsRef,
  onSheltersLoaded,
  fitSheltersRef,
}: {
  smallDots?: boolean;
  onRouteTo?: (target: { lat: number; lng: number; label: string }) => void;
  showFires?: boolean;
  showEvacZones?: boolean;
  onZonesLoaded?: (count: number) => void;
  fitBoundsRef?: React.MutableRefObject<(() => void) | null>;
  onSheltersLoaded?: (count: number) => void;
  fitSheltersRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const map = useMap();
  // Ref-based overlay (v2.7 GoogleRiskMap pattern): create the deck.gl
  // overlay ONCE on mount, then call setProps({layers}) on every state
  // change. Was useState before — that recreated the GoogleMapsOverlay on
  // every render, which tore down the canvas + caused the jumpy zoom flash
  // users were seeing.
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const [tooltip, setTooltip] = useState<any>(null);
  // Callback refs so the layer onClicks in setProps keep firing even when
  // the layer instances get recreated. Without this, after the first
  // setProps round the closures pointed at stale React state setters.
  const setTooltipRef = useRef(setTooltip);
  const setZoneTooltipRef = useRef<any>(null);
  const setHoveredShelterRef = useRef<any>(null);
  useEffect(() => { setTooltipRef.current = setTooltip; }, []);
  const [zoneTooltip, setZoneTooltip] = useState<any>(null);
  useEffect(() => { setZoneTooltipRef.current = setZoneTooltip; }, []);
  const [hoveredShelter, setHoveredShelter] = useState<any>(null);
  useEffect(() => { setHoveredShelterRef.current = setHoveredShelter; }, []);
  const [facilitiesData, setFacilitiesData] = useState<any[]>([]);
  const [clusteredData, setClusteredData] = useState<any[]>([]);
  const [firePerimeters, setFirePerimeters] = useState<any>(null);
  const [evacZones, setEvacZones] = useState<any>(null);
  const [zoom, setZoom] = useState(8);

  // NIFC fire perimeters — so the evac map renders the same "avoid these areas"
  // polygons as the dashboard / risk map. Kept in the same GoogleMapsOverlay as
  // shelter icons so only ONE deck.gl canvas exists on this map.
  useEffect(() => {
    apiFetch('/fire-perimeters')
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((data) => {
        if (data?.features) setFirePerimeters(data);
      })
      .catch((e) => console.warn('NIFC perimeters fetch failed (evac):', e));
  }, []);

  // Statewide CA active evacuation orders/warnings (Cal OES / Genasys aggregated)
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiFetch('/evacuation-zones')
        .then((r) => (r.ok ? r.json() : { features: [] }))
        .then((data) => {
          if (!cancelled && data?.features) {
            setEvacZones(data);
            onZonesLoaded?.(data.features.length);
          }
        })
        .catch((e) => console.warn('Evac zones fetch failed:', e));
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [onZonesLoaded]);

  // Expose a "fit bounds to all active zones" handler to the parent so the
  // header button can call it. Zones are tiny (often <1 km) and centroid
  // pins keep them findable, but users still need a one-click way to dive in.
  useEffect(() => {
    if (!fitBoundsRef) return;
    if (!map || !evacZones?.features?.length) {
      fitBoundsRef.current = null;
      return;
    }
    fitBoundsRef.current = () => {
      const bounds = new google.maps.LatLngBounds();
      const visit = (c: any) => {
        if (typeof c[0] === 'number') bounds.extend({ lng: c[0], lat: c[1] });
        else c.forEach(visit);
      };
      evacZones.features.forEach((f: any) => f.geometry?.coordinates && visit(f.geometry.coordinates));
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, 80);
        // Cap zoom — fitBounds on tiny clustered polygons would otherwise
        // zoom to street level and lose context.
        const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
          if ((map.getZoom() || 0) > 13) map.setZoom(13);
        });
        void listener;
      }
    };
  }, [map, evacZones, fitBoundsRef]);

  // Same pattern for shelters — fit map to all open shelter points.
  useEffect(() => {
    if (!fitSheltersRef) return;
    if (!map || facilitiesData.length === 0) {
      fitSheltersRef.current = null;
      return;
    }
    fitSheltersRef.current = () => {
      const bounds = new google.maps.LatLngBounds();
      for (const f of facilitiesData) {
        const c = f.geometry?.coordinates;
        if (c && typeof c[0] === 'number') bounds.extend({ lng: c[0], lat: c[1] });
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, 80);
        const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
          if ((map.getZoom() || 0) > 11) map.setZoom(11);
        });
        void listener;
      }
    };
  }, [map, facilitiesData, fitSheltersRef]);

  // Shelter facility type icons and colors based on usage code
  const getFacilityStyle = (usageCode: string, facilityType: string) => {
    // EVAC = Evacuation only, POST = Post-impact only, BOTH = Both uses
    const styles: { [key: string]: { icon: string; color: [number, number, number] } } = {
      'EVAC': { icon: '🏃', color: [59, 130, 246] }, // Evacuation - Blue
      'POST': { icon: '🏠', color: [34, 197, 94] }, // Post-Impact - Green
      'BOTH': { icon: '🏛️', color: [147, 51, 234] }, // Both - Purple
    };
    return styles[usageCode] || { icon: '🏢', color: [156, 163, 175] }; // Default gray
  };

  const getFacilityTypeName = (usageCode: string) => {
    const names: { [key: string]: string } = {
      'EVAC': 'Evacuation Shelter',
      'POST': 'Post-Impact Shelter',
      'BOTH': 'Evacuation & Post-Impact',
    };
    return names[usageCode] || 'Shelter';
  };

  // Load GeoJSON data
  useEffect(() => {
    apiFetch('/shelters?state=CA')
      .then(response => response.json())
      .then(data => {
        // User-facing page shows ONLY shelters that are currently active.
        // Defensive CA-bbox filter on top of the server-side state=CA filter
        // guards against any upstream feed bugs that slip a non-CA row in.
        const filtered = (data.features || []).filter((f: any) => {
          const p = f.properties || {};
          if (p.state !== 'CA') return false;
          if (String(p.shelter_status_code || '').toUpperCase() !== 'OPEN') return false;
          const coords = f.geometry?.coordinates;
          const lon = coords?.[0], lat = coords?.[1];
          return isInCA(lat, lon);
        });
        console.log('Active CA shelters:', filtered.length, '/', (data.features || []).length, 'total');
        setFacilitiesData(filtered);
        onSheltersLoaded?.(filtered.length);
      })
      .catch(error => {
        console.error('Error loading shelter data:', error);
      });
  }, []);

  // Close tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('canvas')) {
        setTooltip(null);
      }
    };

    if (tooltip) {
      // setTimeout defers listener registration by one tick so the opening
      // click doesn't immediately trigger handleClickOutside and close the tooltip
      const timer = setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [tooltip]);

  // Update clusters when zoom changes
  useEffect(() => {
    if (!map || facilitiesData.length === 0) return;

    const updateClusters = () => {
      const currentZoom = Math.floor(map.getZoom() || 8);
      setZoom(currentZoom);

      // If small dots mode, disable clustering - show all individual shelters
      if (smallDots) {
        setClusteredData(facilitiesData.map((f: any) => ({
          type: 'Feature',
          properties: { ...f.properties, cluster: false },
          geometry: f.geometry
        })));
        return;
      }

      // Create supercluster index
      const index = new Supercluster({
        radius: 60,
        maxZoom: 16
      });

      // Load points into supercluster
      index.load(facilitiesData.map((f: any) => ({
        type: 'Feature',
        properties: f.properties,
        geometry: f.geometry
      })));

      // Get clusters for current viewport
      const bounds = map.getBounds();
      if (bounds) {
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();

        const clusters = index.getClusters(
          [sw.lng(), sw.lat(), ne.lng(), ne.lat()],
          currentZoom
        );

        setClusteredData(clusters);
      }
    };

    updateClusters();

    // Listen for zoom changes
    const listener = map.addListener('zoom_changed', updateClusters);
    const dragListener = map.addListener('dragend', updateClusters);

    return () => {
      listener.remove();
      dragListener.remove();
    };
  }, [map, facilitiesData, smallDots]);

  useEffect(() => {
    if (!map) return;
    if (
      clusteredData.length === 0 &&
      !firePerimeters?.features?.length &&
      !evacZones?.features?.length
    ) return;

    // No teardown — we update the existing overlay below via setProps.

    const colorForPct = (raw: any): [number, number, number, number] => {
      const pct = raw == null ? 0 : Number(raw);
      if (pct >= 100) return [255, 255, 255, 230];
      if (pct >= 50) return [250, 204, 21, 240];
      if (pct >= 25) return [249, 115, 22, 240];
      return [220, 38, 38, 240];
    };

    // Cal OES / Genasys status → color (RGBA). Lower opacity for fill so fire
    // perimeters and shelter icons remain readable on top.
    const colorForZoneStatus = (status: string | undefined, fill: boolean): [number, number, number, number] => {
      const s = (status || '').toLowerCase();
      if (s.includes('order'))    return fill ? [220, 38, 38, 90]  : [220, 38, 38, 230]; // red
      if (s.includes('warning'))  return fill ? [249, 115, 22, 90] : [249, 115, 22, 230]; // orange
      if (s.includes('shelter'))  return fill ? [147, 51, 234, 90] : [147, 51, 234, 230]; // purple — shelter in place
      if (s.includes('advisory')) return fill ? [250, 204, 21, 80] : [250, 204, 21, 220]; // yellow
      return fill ? [107, 114, 128, 60] : [107, 114, 128, 200];                          // grey fallback
    };

    // Compute centroids so we can render an always-visible pin for each
    // active zone — most CA evacuation orders are ~1 km wide polygons that
    // become sub-pixel at any zoom > regional. The pin keeps them findable.
    const bboxCenter = (geom: any): [number, number] | null => {
      if (!geom?.coordinates) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const visit = (c: any) => {
        if (typeof c[0] === 'number') {
          if (c[0] < minX) minX = c[0];
          if (c[0] > maxX) maxX = c[0];
          if (c[1] < minY) minY = c[1];
          if (c[1] > maxY) maxY = c[1];
        } else c.forEach(visit);
      };
      visit(geom.coordinates);
      if (!isFinite(minX)) return null;
      return [(minX + maxX) / 2, (minY + maxY) / 2];
    };

    const evacZonePoints = (showEvacZones && evacZones?.features?.length)
      ? evacZones.features
          .map((f: any) => ({ center: bboxCenter(f.geometry), props: f.properties || {} }))
          .filter((x: any) => x.center)
      : [];

    const evacZonePolygonLayer = (showEvacZones && evacZones?.features?.length)
      ? new GeoJsonLayer({
          id: 'cal-oes-evac-zones',
          data: evacZones,
          pickable: true,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 1.5,
          getLineColor: (f: any) => colorForZoneStatus(f.properties?.STATUS, false),
          getFillColor: (f: any) => colorForZoneStatus(f.properties?.STATUS, true),
          getLineWidth: 2,
          updateTriggers: {
            getFillColor: [evacZones.features.length],
            getLineColor: [evacZones.features.length],
          },
          onClick: (info: any) => {
            if (info.object) {
              setZoneTooltipRef.current?.({
                x: info.x,
                y: info.y,
                props: info.object.properties || {},
              });
              return true;
            }
            return false;
          },
        })
      : null;

    // Always-visible pins at zone centroids — sized in pixels, so they show up
    // at every zoom. Click opens the same tooltip as the polygon.
    const evacZoneMarkerLayer = evacZonePoints.length
      ? new ScatterplotLayer({
          id: 'cal-oes-evac-zone-markers',
          data: evacZonePoints,
          pickable: true,
          stroked: true,
          filled: true,
          radiusUnits: 'pixels',
          getPosition: (d: any) => d.center,
          getRadius: 9,
          getFillColor: (d: any) => colorForZoneStatus(d.props?.STATUS, false),
          getLineColor: [255, 255, 255, 240],
          lineWidthMinPixels: 2,
          onClick: (info: any) => {
            if (info.object) {
              setZoneTooltipRef.current?.({ x: info.x, y: info.y, props: info.object.props });
              return true;
            }
            return false;
          },
        })
      : null;

    const fireLayer = (showFires && firePerimeters?.features?.length)
      ? new GeoJsonLayer({
          id: 'evac-nifc-perimeters',
          data: firePerimeters,
          pickable: false,
          stroked: true,
          filled: true,
          lineWidthMinPixels: 3,
          getLineColor: (f: any) => colorForPct(f.properties?.attr_PercentContained),
          getFillColor: (f: any) => colorForPct(f.properties?.attr_PercentContained),
          getLineWidth: 3,
          updateTriggers: {
            getFillColor: [firePerimeters.features.length],
            getLineColor: [firePerimeters.features.length],
          },
        })
      : null;

    // Build the layer list — order matters: bottom-up
    // (zone polygons → fire perimeters → shelters → zone pins on top so they're never hidden)
    const layers = [
        ...(evacZonePolygonLayer ? [evacZonePolygonLayer] : []),
        ...(fireLayer ? [fireLayer] : []),
        new IconLayer({
          id: 'fire-facilities-clustered',
          data: clusteredData,
          pickable: true,

          getPosition: (d: any) => d.geometry.coordinates,

          getIcon: (d: any) => {
            const isCluster = d.properties.cluster;
            const pointCount = d.properties.point_count || 1;

            if (isCluster) {
              // Cluster: keep count label, smaller in smallDots mode
              const size = smallDots ? 18 : 50;
              const radius = smallDots ? 8 : 22;
              const fontSize = smallDots ? 8 : 16;
              return {
                url: `data:image/svg+xml;utf8,${encodeURIComponent(`
                  <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="rgb(59, 130, 246)" stroke="white" stroke-width="${smallDots ? 1.5 : 3}"/>
                    <text x="${size/2}" y="${size/2 + fontSize/2.5}" font-size="${fontSize}" font-weight="bold" text-anchor="middle" fill="white">${pointCount}</text>
                  </svg>
                `)}`,
                width: size,
                height: size,
                anchorY: size
              };
            } else {
              const style = getFacilityStyle(d.properties.facility_usage_code, d.properties.facility_type);
              if (smallDots) {
                // Small mode: plain colored dot, no emoji
                const size = 10;
                const radius = 4;
                return {
                  url: `data:image/svg+xml;utf8,${encodeURIComponent(`
                    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="rgb(${style.color.join(',')})" stroke="white" stroke-width="1"/>
                    </svg>
                  `)}`,
                  width: size,
                  height: size,
                  anchorY: size
                };
              }
              // Normal mode: circle with emoji
              const size = 40;
              const radius = 16;
              const fontSize = 18;
              return {
                url: `data:image/svg+xml;utf8,${encodeURIComponent(`
                  <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="rgb(${style.color.join(',')})" stroke="white" stroke-width="2"/>
                    <text x="${size/2}" y="${size/2 + fontSize/2.5}" font-size="${fontSize}" text-anchor="middle" fill="white">${style.icon}</text>
                  </svg>
                `)}`,
                width: size,
                height: size,
                anchorY: size
              };
            }
          },

          getSize: (d: any) => {
            const isCluster = d.properties.cluster;
            const pointCount = d.properties.point_count || 1;
            if (isCluster) {
              if (smallDots) return Math.min(18 + (pointCount / 30), 28);
              return Math.min(50 + (pointCount / 10), 80);
            }
            return smallDots ? 10 : 40;
          },

          // Add hover handler
          onHover: (info: any) => {
            if (info.object) {
              setHoveredShelterRef.current?.(info.object.properties);
            } else {
              setHoveredShelterRef.current?.(null);
            }
          },

          onClick: (info: any) => {
            if (info.object) {
              const isCluster = info.object.properties.cluster;

              if (isCluster) {
                // Zoom into cluster
                const expansionZoom = Math.min(
                  map.getZoom()! + 2,
                  16
                );

                map.setZoom(expansionZoom);
                map.panTo({
                  lat: info.object.geometry.coordinates[1],
                  lng: info.object.geometry.coordinates[0]
                });
              } else {
                // Show tooltip for individual shelter
                const props = info.object.properties;
                const coords = info.object.geometry?.coordinates;
                setTooltipRef.current?.({
                  x: info.x,
                  y: info.y,
                  content: {
                    ...props,
                    longitude: coords?.[0],
                    latitude: coords?.[1],
                  }
                });
              }
              return true;
            }
          }
        }),
        ...(evacZoneMarkerLayer ? [evacZoneMarkerLayer] : []),
      ];

    // Smooth path: reuse the existing overlay if we have one.
    if (overlayRef.current) {
      overlayRef.current.setProps({ layers });
    } else {
      overlayRef.current = new GoogleMapsOverlay({ layers });
      overlayRef.current.setMap(map);
    }
    // No per-effect cleanup — the overlay lives for the lifetime of the
    // component; an unmount-only effect (below) tears it down.
  }, [map, clusteredData, firePerimeters, evacZones, showFires, showEvacZones]);

  // Unmount-only teardown for the deck.gl overlay.
  useEffect(() => {
    return () => {
      if (overlayRef.current) {
        overlayRef.current.setMap(null);
        overlayRef.current.finalize();
        overlayRef.current = null;
      }
    };
  }, []);

  return (
    <>
      {/* Floating legend — top-right of the map, shared with Research page.
          Wrapper is pointer-events-none so map clicks pass through the empty
          space beside the legend; the legend card itself re-enables pointer
          events so users can still interact with any links inside it. */}
      <div className="absolute top-3 right-3 z-[5] pointer-events-none">
        <div className="pointer-events-auto">
          <ShelterEvacLegend />
        </div>
      </div>

      {/* Evacuation zone info — centered card with every CalOES field we have. */}
      <CenteredInfoCard
        open={!!zoneTooltip}
        onClose={() => setZoneTooltip(null)}
        accent={
          zoneTooltip?.props?.STATUS?.toLowerCase().includes('order')   ? 'bg-red-700'    :
          zoneTooltip?.props?.STATUS?.toLowerCase().includes('warning') ? 'bg-amber-600'  :
          zoneTooltip?.props?.STATUS?.toLowerCase().includes('shelter') ? 'bg-purple-600' :
          'bg-yellow-500'
        }
        title={zoneTooltip?.props?.ZONE_NAME || zoneTooltip?.props?.ZONE_ID || 'Evacuation Zone'}
        subtitle={zoneTooltip?.props?.COUNTY ? `${zoneTooltip.props.COUNTY} County` : undefined}
      >
        {zoneTooltip?.props && (() => {
          const p = zoneTooltip.props;
          const status: string = p.STATUS || '';
          const lower = status.toLowerCase();
          const statusBg =
            lower.includes('order')   ? 'bg-red-100 text-red-900 border-red-200' :
            lower.includes('warning') ? 'bg-amber-100 text-amber-900 border-amber-200' :
            lower.includes('shelter') ? 'bg-purple-100 text-purple-900 border-purple-200' :
            'bg-yellow-100 text-yellow-900 border-yellow-200';
          return (
            <div className="space-y-3">
              {status && (
                <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-semibold border ${statusBg}`}>
                  {status}
                </span>
              )}
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                {p.ZONE_ID && (<><dt className="col-span-1 text-zinc-500">Zone ID</dt><dd className="col-span-2 font-mono text-[11px]">{p.ZONE_ID}</dd></>)}
                {p.COUNTY && (<><dt className="col-span-1 text-zinc-500">County</dt><dd className="col-span-2">{p.COUNTY}</dd></>)}
                {p.EVENT_TYPE && (<><dt className="col-span-1 text-zinc-500">Event</dt><dd className="col-span-2">{p.EVENT_TYPE}</dd></>)}
                {p.STATEWIDE_LAST_UPDATED && (
                  <>
                    <dt className="col-span-1 text-zinc-500">Last updated</dt>
                    <dd className="col-span-2">
                      {new Date(p.STATEWIDE_LAST_UPDATED).toLocaleString()}
                      {' '}
                      <span className="text-zinc-400">({Math.max(1, Math.round((Date.now() - new Date(p.STATEWIDE_LAST_UPDATED).getTime()) / 60000))} min ago)</span>
                    </dd>
                  </>
                )}
              </dl>
              {p.CRITICAL_INFO && (
                <div className="border-l-3 border-red-500 pl-3 py-1 bg-red-50/60 text-zinc-900 text-sm rounded-r">
                  <div className="font-semibold text-xs text-red-800 mb-0.5">Critical info</div>
                  {p.CRITICAL_INFO}
                </div>
              )}
              {p.PUBLIC_INFO && (
                <div className="text-sm text-zinc-700">
                  <div className="font-semibold text-xs text-zinc-500 mb-0.5">Public info</div>
                  {p.PUBLIC_INFO}
                </div>
              )}
              <div className="pt-2 border-t border-zinc-100 text-[11px] text-zinc-400">
                Source: Cal OES statewide aggregation (CA_EVACUATIONS_PROD) — the same feed Watch Duty consumes.
              </div>
            </div>
          );
        })()}
      </CenteredInfoCard>

      {/* Shelter info — centered card with every metadata field we have. */}
      <CenteredInfoCard
        open={!!tooltip}
        onClose={() => setTooltip(null)}
        accent="bg-emerald-600"
        title={tooltip?.content?.shelter_name || 'Shelter'}
        subtitle={getFacilityTypeName(tooltip?.content?.facility_usage_code) + (tooltip?.content?.facility_type ? ` · ${tooltip.content.facility_type}` : '')}
      >
        {tooltip?.content && (() => {
          const s = tooltip.content;
          const fields: Array<[string, string | number | undefined | null]> = [
            ['Status', s.shelter_status_code],
            ['Address', s.address_1],
            ['City / ZIP', s.city ? `${s.city}, ${s.state || 'CA'} ${s.zip || ''}` : null],
            ['County', s.county_parish],
            ['Facility type', s.facility_type],
            ['Facility usage', s.facility_usage_code],
            ['Evac capacity', s.evacuation_capacity ? `${s.evacuation_capacity} people` : null],
            ['Post-impact capacity', s.post_impact_capacity ? `${s.post_impact_capacity} people` : null],
            ['Wheelchair accessible', s.wheelchair_accessible === 'YES' ? 'Yes' : null],
            ['Generator on-site', s.generator_onsite === 'YES' ? 'Yes' : null],
            ['Shelter ID', s.shelter_id ? String(s.shelter_id) : null],
            ['Coordinates', s.latitude != null && s.longitude != null ? `${Number(s.latitude).toFixed(4)}, ${Number(s.longitude).toFixed(4)}` : null],
          ];
          return (
            <div className="space-y-3">
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                {fields.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="col-span-1 text-zinc-500">{k}</dt>
                    <dd className="col-span-2 text-zinc-800 break-words">{v}</dd>
                  </div>
                ))}
              </dl>
              {s.latitude != null && s.longitude != null && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-100">
                  {onRouteTo && (
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => {
                        onRouteTo({ lat: s.latitude, lng: s.longitude, label: s.shelter_name || 'Shelter' });
                        setTooltip(null);
                      }}
                    >
                      Route on this map
                    </Button>
                  )}
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${s.latitude},${s.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2"
                  >
                    Open in Google Maps
                  </a>
                </div>
              )}
              <div className="pt-2 border-t border-zinc-100 text-[11px] text-zinc-400">
                Source: CalOES California Shelter system mirror of the FEMA NSS inventory.
              </div>
            </div>
          );
        })()}
      </CenteredInfoCard>

      {/* Hover Tooltip - small tooltip on hover */}
      {hoveredShelter && !hoveredShelter.cluster && !tooltip && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '4px',
            fontSize: '13px',
            zIndex: 999,
            pointerEvents: 'none',
            maxWidth: '250px'
          }}
        >
          <div className="font-bold">{hoveredShelter.shelter_name || hoveredShelter.facility_name || 'Shelter'}</div>
          <div className="text-xs mt-1">
            {hoveredShelter.city && `${hoveredShelter.city}, ${hoveredShelter.state || 'CA'}`}
          </div>
          {hoveredShelter.evacuation_capacity > 0 && (
            <div className="text-xs">Capacity: {hoveredShelter.evacuation_capacity}</div>
          )}
        </div>
      )}

      {/* Cluster hover tooltip */}
      {hoveredShelter && hoveredShelter.cluster && !tooltip && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            backgroundColor: 'rgba(59, 130, 246, 0.9)',
            color: 'white',
            padding: '6px 10px',
            borderRadius: '4px',
            fontSize: '12px',
            zIndex: 999,
            pointerEvents: 'none'
          }}
        >
          {hoveredShelter.point_count} shelters
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Directions panel — routes to nearest shelter via Google Directions */
/* ------------------------------------------------------------------ */
function DirectionsPanel({
  open,
  onClose,
  routeTarget,
}: {
  open: boolean;
  onClose: () => void;
  routeTarget?: { lat: number; lng: number; label: string } | null;
}) {
  const map = useMap();
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [destination, setDestination] = useState("");
  const [routeInfo, setRouteInfo] = useState<{
    distance: string;
    duration: string;
    durationInTraffic?: string;
    steps: string[];
    summary: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);

  // Get user location once the panel opens (or a shelter route is requested)
  useEffect(() => {
    if ((open || routeTarget) && !userLat) {
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          setUserLat(pos.coords.latitude);
          setUserLng(pos.coords.longitude);
        },
        () => {
          setUserLat(34.0522);
          setUserLng(-118.2437);
        }
      );
    }
  }, [open, routeTarget, userLat]);

  // Cleanup renderer on close
  useEffect(() => {
    if (!open && rendererRef.current) {
      rendererRef.current.setMap(null);
      rendererRef.current = null;
      setRouteInfo(null);
    }
  }, [open]);

  const calculateRoute = async () => {
    if (!map || !userLat || !userLng || !destination.trim()) return;
    setLoading(true);
    setError("");
    setRouteInfo(null);

    try {
      const service = new google.maps.DirectionsService();
      const result = await service.route({
        origin: { lat: userLat, lng: userLng },
        destination: destination,
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: true,
        drivingOptions: {
          departureTime: new Date(),
          trafficModel: google.maps.TrafficModel.BEST_GUESS,
        },
      });

      if (result.routes.length > 0) {
        const route = result.routes[0];
        const leg = route.legs[0];

        // Render route on map
        if (rendererRef.current) rendererRef.current.setMap(null);
        const renderer = new google.maps.DirectionsRenderer({
          map,
          directions: result,
          polylineOptions: { strokeColor: "#dc2626", strokeWeight: 5 },
        });
        rendererRef.current = renderer;

        setRouteInfo({
          distance: leg.distance?.text || "Unknown",
          duration: leg.duration?.text || "Unknown",
          durationInTraffic: leg.duration_in_traffic?.text,
          steps: leg.steps.map((s) => s.instructions.replace(/<[^>]+>/g, "")),
          summary: route.summary,
        });
      }
    } catch (e: any) {
      setError(e.message || "Failed to calculate route");
    }
    setLoading(false);
  };

  const findNearestShelter = () => {
    setDestination("nearest emergency shelter California");
  };

  // Auto-route when a shelter is picked from the map
  useEffect(() => {
    if (!routeTarget || !map || !userLat || !userLng) return;
    const dest = `${routeTarget.lat},${routeTarget.lng}`;
    setDestination(routeTarget.label || dest);

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      setRouteInfo(null);
      try {
        const service = new google.maps.DirectionsService();
        const result = await service.route({
          origin: { lat: userLat, lng: userLng },
          destination: { lat: routeTarget.lat, lng: routeTarget.lng },
          travelMode: google.maps.TravelMode.DRIVING,
          provideRouteAlternatives: true,
          drivingOptions: {
            departureTime: new Date(),
            trafficModel: google.maps.TrafficModel.BEST_GUESS,
          },
        });
        if (cancelled) return;
        if (result.routes.length > 0) {
          const route = result.routes[0];
          const leg = route.legs[0];
          if (rendererRef.current) rendererRef.current.setMap(null);
          const renderer = new google.maps.DirectionsRenderer({
            map,
            directions: result,
            polylineOptions: { strokeColor: "#16a34a", strokeWeight: 5 },
          });
          rendererRef.current = renderer;
          setRouteInfo({
            distance: leg.distance?.text || "Unknown",
            duration: leg.duration?.text || "Unknown",
            durationInTraffic: leg.duration_in_traffic?.text,
            steps: leg.steps.map((s) => s.instructions.replace(/<[^>]+>/g, "")),
            summary: route.summary,
          });
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to calculate route");
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [routeTarget, map, userLat, userLng]);

  if (!open) return null;

  return (
    <Card className="border-red-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Navigation className="h-4 w-4" /> Evacuation Directions
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-xs font-medium">Your Location</label>
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              value={userLat && userLng ? `${userLat.toFixed(4)}, ${userLng.toFixed(4)}` : "Detecting..."}
              readOnly
              className="flex-1 rounded-md border px-2 py-1 text-sm bg-muted"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium">Destination</label>
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Shelter address or name..."
              className="flex-1 rounded-md border px-2 py-1 text-sm"
            />
            <Button size="sm" variant="outline" onClick={findNearestShelter}>Nearest</Button>
          </div>
        </div>
        <Button
          size="sm"
          className="w-full"
          onClick={calculateRoute}
          disabled={loading || !destination.trim()}
        >
          {loading ? "Calculating..." : "Get Route"}
        </Button>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {routeInfo && (
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-lg font-bold">{routeInfo.duration}</span>
                {routeInfo.durationInTraffic && routeInfo.durationInTraffic !== routeInfo.duration && (
                  <span className="text-sm text-orange-600 ml-2">({routeInfo.durationInTraffic} with traffic)</span>
                )}
              </div>
              <Badge variant="outline">{routeInfo.distance}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">via {routeInfo.summary}</p>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {routeInfo.steps.map((step, i) => (
                <div key={i} className="text-xs text-muted-foreground flex gap-2">
                  <span className="text-foreground font-medium shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EvacuationRoutes() {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [checklistLevel, setChecklistLevel] = useState<'prepare' | 'fireWatch' | 'evacuationWarning' | 'evacuateNow'>('prepare');
  const [checkedItems, setCheckedItems] = useState<{[key: string]: boolean}>({});
  const [smallDots, setSmallDots] = useState(false);
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [routeTarget, setRouteTarget] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [showFires, setShowFires] = useState(true);
  const [showEvacZones, setShowEvacZones] = useState(true);
  const [activeZoneCount, setActiveZoneCount] = useState(0);
  const fitZonesRef = useRef<(() => void) | null>(null);
  const [openShelterCount, setOpenShelterCount] = useState(0);
  const fitSheltersRef = useRef<(() => void) | null>(null);

  const handleRouteTo = (target: { lat: number; lng: number; label: string }) => {
    setRouteTarget(target);
    setDirectionsOpen(true);
  };

  const toggleCheckbox = (level: string, index: number) => {
    const key = `${level}-${index}`;
    setCheckedItems(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const getCompletionCount = (level: 'prepare' | 'fireWatch' | 'evacuationWarning' | 'evacuateNow') => {
    const items = safetyChecklist[level];
    const checked = items.filter((_, index) => checkedItems[`${level}-${index}`]).length;
    return `${checked}/${items.length}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "mandatory":
        return <Badge className="bg-red-100 text-red-800 border-red-200">Mandatory</Badge>;
      case "voluntary":
        return <Badge className="bg-orange-100 text-orange-800 border-orange-200">Voluntary</Badge>;
      case "watch":
        return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Watch</Badge>;
      default:
        return <Badge variant="outline">Clear</Badge>;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Shelters & Evacuation</h1>
          <p className="text-muted-foreground">
            Find a shelter near you, get directions, and review evacuation guidance — anytime, not just during an emergency.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setDirectionsOpen(!directionsOpen)}>
            <Navigation className="h-4 w-4 mr-2" />
            {directionsOpen ? "Hide Directions" : "Get Directions"}
          </Button>
          <Button size="sm">
            <Phone className="h-4 w-4 mr-2" />
            Emergency: 911
          </Button>
        </div>
      </div>

      {/* Directions Panel */}
      <DirectionsPanel
        open={directionsOpen}
        onClose={() => {
          setDirectionsOpen(false);
          setRouteTarget(null);
        }}
        routeTarget={routeTarget}
      />

      {/* Active Evacuation Banner — visible only when CA has active orders */}
      {activeZoneCount > 0 && (
        <Alert className="border-l-4 border-l-red-500 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <AlertDescription>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm">
                <strong className="text-red-700">{activeZoneCount} active evacuation order{activeZoneCount === 1 ? '' : 's'}</strong> in California right now (Cal OES live feed). They appear as red dots on the map below — click "Show on map" to zoom to them.
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => fitZonesRef.current?.()}
              >
                Show on map
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Active Shelter Banner — always visible so users see the live state,
          even when zero (the normal idle case in CalOES). */}
      <Alert className={`border-l-4 ${openShelterCount > 0 ? 'border-l-emerald-600 bg-emerald-50' : 'border-l-zinc-300 bg-zinc-50'}`}>
        <Shield className={`h-4 w-4 ${openShelterCount > 0 ? 'text-emerald-700' : 'text-zinc-500'}`} />
        <AlertDescription>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              {openShelterCount > 0 ? (
                <>
                  <strong className="text-emerald-700">{openShelterCount} open shelter{openShelterCount === 1 ? '' : 's'}</strong> in California right now (CalOES live feed). They appear as pins on the map below — click "Show on map" to zoom to them.
                </>
              ) : (
                <>
                  <strong className="text-zinc-700">0 open shelters</strong> in California right now (CalOES live feed). Most pre-staged shelters only activate during an emergency.
                </>
              )}
            </div>
            {openShelterCount > 0 && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => fitSheltersRef.current?.()}
              >
                Show on map
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>

      {/* Interactive Map with Fire Facilities */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Find a Shelter
          </CardTitle>

          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={showEvacZones}
                onChange={(e) => setShowEvacZones(e.target.checked)}
                className="w-4 h-4 cursor-pointer accent-red-600"
              />
              <span className="font-medium">Evacuation Zones</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={showFires}
                onChange={(e) => setShowFires(e.target.checked)}
                className="w-4 h-4 cursor-pointer accent-orange-600"
              />
              <span className="font-medium">Active Fires</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={smallDots}
                onChange={(e) => setSmallDots(e.target.checked)}
                className="w-4 h-4 cursor-pointer"
              />
              <span className="font-medium">Small Icons</span>
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {/* Google Map with Deck.gl Overlay */}
          <div className="w-full h-96 rounded-lg overflow-hidden border">
            <Map
              style={{ width: '100%', height: '100%' }}
              defaultCenter={{ lat: 34.0549, lng: -118.2426 }}
              defaultZoom={8}
              gestureHandling="greedy"
              disableDefaultUI={false}
            >
              <FireFacilitiesOverlay
                smallDots={smallDots}
                onRouteTo={handleRouteTo}
                showFires={showFires}
                showEvacZones={showEvacZones}
                onZonesLoaded={setActiveZoneCount}
                fitBoundsRef={fitZonesRef}
                onSheltersLoaded={setOpenShelterCount}
                fitSheltersRef={fitSheltersRef}
              />
              <SavedLocationsOverlay />
            </Map>
          </div>

          {/* Map Legend */}
          <div className="mt-4 bg-gray-50 rounded-lg p-4">
            <h4 className="font-semibold text-base mb-3">Map Legend</h4>

            {/* Clustering explanation */}
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

            {/* Shelter types */}
            <div className="space-y-2">
              <div className="text-base font-semibold text-muted-foreground mb-2">Emergency Shelter Types:</div>

              <div className="grid grid-cols-1 gap-2 text-base">
                {/* Evacuation Shelters */}
                <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-100">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{backgroundColor: 'rgb(59, 130, 246)'}}>
                    <span className="text-base">🏃</span>
                  </div>
                  <div>
                    <div><strong>Evacuation Shelter</strong></div>
                    <div className="text-xs text-muted-foreground">Pre-disaster evacuation only</div>
                  </div>
                </div>

                {/* Post-Impact Shelters */}
                <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-100">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{backgroundColor: 'rgb(34, 197, 94)'}}>
                    <span className="text-base">🏠</span>
                  </div>
                  <div>
                    <div><strong>Post-Impact Shelter</strong></div>
                    <div className="text-xs text-muted-foreground">After disaster relief</div>
                  </div>
                </div>

                {/* Both */}
                <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-100">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{backgroundColor: 'rgb(147, 51, 234)'}}>
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
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-sm text-muted-foreground">
                💡 <strong>How to use:</strong> Click blue clusters to zoom in. Click individual shelters to see capacity, accessibility, and amenities. Drag to pan, scroll to zoom. FEMA - National Shelter System Facilities
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Evacuation Zones and Assembly Points Grid */}
      {/* COMMENTED OUT - Uncomment when ready to use
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Evacuation Zones */}
        {/* <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Evacuation Zones
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {evacuationZones.map((zone) => (
              <div
                key={zone.id}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedZone === zone.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setSelectedZone(selectedZone === zone.id ? null : zone.id)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full ${zone.color}`}></div>
                    <div>
                      <h3 className="font-medium">{zone.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {zone.population.toLocaleString()} residents
                      </p>
                    </div>
                  </div>
                  {getStatusBadge(zone.status)}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>{zone.estimatedTime}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Car className="h-4 w-4 text-muted-foreground" />
                    <span>{zone.routes.length} routes</span>
                  </div>
                </div>

                {selectedZone === zone.id && (
                  <div className="mt-4 pt-4 border-t">
                    <h4 className="font-medium mb-2">Recommended Routes:</h4>
                    <ul className="space-y-1">
                      {zone.routes.map((route, index) => (
                        <li key={index} className="text-sm text-muted-foreground flex items-center gap-2">
                          <Navigation className="h-3 w-3" />
                          {route}
                        </li>
                      ))}
                    </ul>
                    <Button size="sm" className="mt-3">
                      <Navigation className="h-4 w-4 mr-2" />
                      Get Route Directions
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card> */}

        {/* Assembly Points */}
        {/* <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Assembly Points
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {assemblyPoints.map((point, index) => (
              <div key={index} className="p-4 rounded-lg border">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-medium">{point.name}</h3>
                    <p className="text-sm text-muted-foreground">{point.address}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {point.distance}
                  </Badge>
                </div>

                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    <span>{point.capacity} capacity</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  {point.amenities.map((amenity, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {amenity}
                    </Badge>
                  ))}
                </div>

                <Button size="sm" variant="outline" className="w-full">
                  <Navigation className="h-4 w-4 mr-2" />
                  Get Directions
                </Button>
              </div>
            ))}
          </CardContent>
        </Card> */}
      {/* </div> */}
      {/* END COMMENTED OUT SECTION */}

      {/* Safety Checklist and Emergency Contacts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Safety Checklist */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Evacuation Checklist
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Level Selector */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Button
                variant={checklistLevel === 'prepare' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setChecklistLevel('prepare')}
                className="text-xs flex flex-col items-center py-3 h-auto"
              >
                <div className="flex items-center gap-1">
                  <span>📋</span>
                  <span>Prepare</span>
                </div>
                <span className="text-[10px] opacity-75 mt-0.5">{getCompletionCount('prepare')}</span>
              </Button>
              <Button
                variant={checklistLevel === 'fireWatch' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setChecklistLevel('fireWatch')}
                className="text-xs flex flex-col items-center py-3 h-auto bg-yellow-50 hover:bg-yellow-100 text-yellow-800 border-yellow-300"
                style={checklistLevel === 'fireWatch' ? {backgroundColor: '#fbbf24', color: 'white'} : {}}
              >
                <div className="flex items-center gap-1">
                  <span>⚠️</span>
                  <span>Fire Watch</span>
                </div>
                <span className="text-[10px] opacity-75 mt-0.5">{getCompletionCount('fireWatch')}</span>
              </Button>
              <Button
                variant={checklistLevel === 'evacuationWarning' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setChecklistLevel('evacuationWarning')}
                className="text-xs flex flex-col items-center py-3 h-auto bg-orange-50 hover:bg-orange-100 text-orange-800 border-orange-300"
                style={checklistLevel === 'evacuationWarning' ? {backgroundColor: '#f97316', color: 'white'} : {}}
              >
                <div className="flex items-center gap-1">
                  <span>🚨</span>
                  <span>Warning</span>
                </div>
                <span className="text-[10px] opacity-75 mt-0.5">{getCompletionCount('evacuationWarning')}</span>
              </Button>
              <Button
                variant={checklistLevel === 'evacuateNow' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setChecklistLevel('evacuateNow')}
                className="text-xs flex flex-col items-center py-3 h-auto bg-red-50 hover:bg-red-100 text-red-800 border-red-300"
                style={checklistLevel === 'evacuateNow' ? {backgroundColor: '#dc2626', color: 'white'} : {}}
              >
                <div className="flex items-center gap-1">
                  <span>🔥</span>
                  <span>Evacuate Now</span>
                </div>
                <span className="text-[10px] opacity-75 mt-0.5">{getCompletionCount('evacuateNow')}</span>
              </Button>
            </div>

            {/* Checklist Items */}
            <div className="space-y-2">
              {safetyChecklist[checklistLevel].map((item, index) => {
                const key = `${checklistLevel}-${index}`;
                const isChecked = checkedItems[key];

                return (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer transition-all"
                    onClick={() => toggleCheckbox(checklistLevel, index)}
                  >
                    <div
                      className={`w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        isChecked
                          ? 'bg-green-500 border-green-500'
                          : 'border-muted-foreground'
                      }`}
                    >
                      {isChecked && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="3"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path d="M5 13l4 4L19 7"></path>
                        </svg>
                      )}
                    </div>
                    <span className={`text-sm ${isChecked ? 'line-through text-muted-foreground' : ''}`}>
                      {item}
                    </span>
                  </div>
                );
              })}
            </div>

            {/*<Button className="w-full mt-4" variant="outline">
              Download Full Emergency Plan
            </Button>*/}
          </CardContent>
        </Card>

        {/* Emergency Contacts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-5 w-5" />
              Emergency Contacts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                <div>
                  <h3 className="font-medium text-red-800">Emergency Services</h3>
                  <p className="text-sm text-red-600">Fire, Police, Medical</p>
                </div>
                <Button size="sm" variant="destructive">
                  <Phone className="h-4 w-4 mr-2" />
                  911
                </Button>
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <h3 className="font-medium">Fire Department</h3>
                  <p className="text-sm text-muted-foreground">Non-emergency line</p>
                </div>
                <Button size="sm" variant="outline">
                  <Phone className="h-4 w-4 mr-2" />
                  (555) 123-4567
                </Button>
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <h3 className="font-medium">Evacuation Hotline</h3>
                  <p className="text-sm text-muted-foreground">24/7 information line</p>
                </div>
                <Button size="sm" variant="outline">
                  <Phone className="h-4 w-4 mr-2" />
                  (555) 987-6543
                </Button>
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <h3 className="font-medium">Red Cross Shelter</h3>
                  <p className="text-sm text-muted-foreground">Emergency assistance</p>
                </div>
                <Button size="sm" variant="outline">
                  <Phone className="h-4 w-4 mr-2" />
                  (555) 456-7890
                </Button>
              </div>
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Save these numbers in your phone and write them down.
                Cell towers may be overloaded during emergencies.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
