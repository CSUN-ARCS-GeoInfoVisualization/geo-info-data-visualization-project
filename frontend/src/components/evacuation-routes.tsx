import { useState, useEffect } from "react";
import { MapPin, Phone, AlertTriangle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Map, Marker, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { IconLayer } from '@deck.gl/layers';
import Supercluster from 'supercluster';

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
function FireFacilitiesOverlay({ smallDots = false }: { smallDots?: boolean }) {
  const map = useMap();
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null);
  const [tooltip, setTooltip] = useState<any>(null);
  const [hoveredShelter, setHoveredShelter] = useState<any>(null);
  const [facilitiesData, setFacilitiesData] = useState<any[]>([]);
  const [clusteredData, setClusteredData] = useState<any[]>([]);
  const [zoom, setZoom] = useState(8);

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
    fetch('/Data/National_Shelter_System_Facilities.geojson')
      .then(response => response.json())
      .then(data => {
        console.log('Loaded shelters:', data.features.length);
        // Filter for California only
        const californiaFeatures = data.features.filter(
          (f: any) => f.properties.state === 'CA' && f.properties.shelter_status_code !== 'DECOMMISSIONED'
        );
        console.log('California shelters:', californiaFeatures.length);
        setFacilitiesData(californiaFeatures);
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
    if (!map || clusteredData.length === 0) return;

    // Clean up old overlay first
    if (overlay) {
      overlay.setMap(null);
      overlay.finalize();
    }

    // Create new deck.gl overlay
    const deckOverlay = new GoogleMapsOverlay({
      layers: [
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
              setHoveredShelter(info.object.properties);
            } else {
              setHoveredShelter(null);
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
                setTooltip({
                  x: info.x,
                  y: info.y,
                  content: props
                });
              }
            }
          }
        })
      ]
    });

    deckOverlay.setMap(map);
    setOverlay(deckOverlay);

    return () => {
      if (deckOverlay) {
        deckOverlay.setMap(null);
        deckOverlay.finalize();
      }
    };
  }, [map, clusteredData]);

  return (
    <>
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            zIndex: 1000,
            pointerEvents: 'auto',
            left: tooltip.x + 10,
            top: tooltip.y + 10,
            backgroundColor: 'white',
            padding: '12px',
            borderRadius: '8px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            maxWidth: '300px',
            border: '1px solid #e5e7eb',
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setTooltip(null)}
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '18px',
              color: '#6b7280',
              padding: '0',
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>

          <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '4px', paddingRight: '20px' }}>
              {tooltip.content.shelter_name}
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              {getFacilityTypeName(tooltip.content.facility_usage_code)}
            </div>
          </div>

          <div style={{ fontSize: '12px', lineHeight: '1.6' }}>
            {tooltip.content.address_1 && (
              <div><strong>Address:</strong> {tooltip.content.address_1}</div>
            )}
            {tooltip.content.city && (
              <div><strong>City:</strong> {tooltip.content.city}, {tooltip.content.state} {tooltip.content.zip}</div>
            )}
            {tooltip.content.county_parish && (
              <div><strong>County:</strong> {tooltip.content.county_parish}</div>
            )}
            {tooltip.content.evacuation_capacity > 0 && (
              <div><strong>Evac Capacity:</strong> {tooltip.content.evacuation_capacity} people</div>
            )}
            {tooltip.content.post_impact_capacity > 0 && (
              <div><strong>Post-Impact Capacity:</strong> {tooltip.content.post_impact_capacity} people</div>
            )}
            {tooltip.content.wheelchair_accessible === 'YES' && (
              <div style={{color: '#16a34a'}}>♿ Wheelchair Accessible</div>
            )}
            {tooltip.content.generator_onsite === 'YES' && (
              <div style={{color: '#16a34a'}}>⚡ Generator On-Site</div>
            )}
          </div>
        </div>
      )}

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

export function EvacuationRoutes() {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [checklistLevel, setChecklistLevel] = useState<'prepare' | 'fireWatch' | 'evacuationWarning' | 'evacuateNow'>('prepare');
  const [checkedItems, setCheckedItems] = useState<{[key: string]: boolean}>({});
  const [smallDots, setSmallDots] = useState(false); // Small dots toggle

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
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-heading">Evacuation Routes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Shelter locations, zones, and emergency contacts for California
          </p>
        </div>
        <Button size="sm" variant="destructive">
          <Phone className="h-4 w-4 mr-2" />
          Emergency: 911
        </Button>
      </div>

      {/* Map (2/3) + Checklist (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Map */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4" />
                Shelter &amp; Evacuation Map
              </CardTitle>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={smallDots}
                  onChange={(e) => setSmallDots(e.target.checked)}
                  className="w-4 h-4 cursor-pointer"
                />
                Small Icons
              </label>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="w-full rounded-lg overflow-hidden border" style={{ height: '420px' }}>
                <Map
                  style={{ width: '100%', height: '100%' }}
                  defaultCenter={{ lat: 34.0549, lng: -118.2426 }}
                  defaultZoom={8}
                  gestureHandling="greedy"
                  disableDefaultUI={false}
                >
                  <FireFacilitiesOverlay smallDots={smallDots} />
                </Map>
              </div>

              {/* Map Legend */}
              <div className="mt-4 bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-base mb-3">Map Legend</h4>

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

                <div className="space-y-2">
                  <div className="text-base font-semibold text-muted-foreground mb-2">Emergency Shelter Types:</div>
                  <div className="grid grid-cols-1 gap-2 text-base">
                    <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-100">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgb(59, 130, 246)' }}>
                        <span className="text-base">🏃</span>
                      </div>
                      <div>
                        <div><strong>Evacuation Shelter</strong></div>
                        <div className="text-xs text-muted-foreground">Pre-disaster evacuation only</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-100">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgb(34, 197, 94)' }}>
                        <span className="text-base">🏠</span>
                      </div>
                      <div>
                        <div><strong>Post-Impact Shelter</strong></div>
                        <div className="text-xs text-muted-foreground">After disaster relief</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded hover:bg-gray-100">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgb(147, 51, 234)' }}>
                        <span className="text-base">🏛️</span>
                      </div>
                      <div>
                        <div><strong>Dual-Purpose Shelter</strong></div>
                        <div className="text-xs text-muted-foreground">Both evacuation &amp; post-impact</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200">
                  <p className="text-sm text-muted-foreground">
                    💡 <strong>How to use:</strong> Click blue clusters to zoom in. Click individual shelters to see capacity, accessibility, and amenities. Drag to pan, scroll to zoom. FEMA - National Shelter System Facilities
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Evacuation Checklist */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle className="h-4 w-4" />
              Evacuation Checklist
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Level selector */}
            <div className="grid grid-cols-2 gap-1.5 mb-4">
              {([
                { key: 'prepare',           label: 'Prepare',      color: '' },
                { key: 'fireWatch',         label: 'Fire Watch',   color: '#ca8a04' },
                { key: 'evacuationWarning', label: 'Warning',      color: '#ea580c' },
                { key: 'evacuateNow',       label: 'Evacuate Now', color: '#dc2626' },
              ] as const).map(({ key, label, color }) => {
                const active = checklistLevel === key;
                return (
                  <button
                    key={key}
                    onClick={() => setChecklistLevel(key)}
                    className={`text-xs rounded-md px-2 py-2 border font-medium transition-colors ${
                      active ? 'text-white border-transparent' : 'bg-background text-muted-foreground hover:text-foreground'
                    }`}
                    style={active ? { backgroundColor: color || '#18181b', borderColor: 'transparent' } : {}}
                  >
                    <div>{label}</div>
                    <div className="opacity-70 mt-0.5" style={{ fontSize: '10px' }}>{getCompletionCount(key)}</div>
                  </button>
                );
              })}
            </div>

            {/* Items */}
            <div className="space-y-1">
              {safetyChecklist[checklistLevel].map((item, index) => {
                const key = `${checklistLevel}-${index}`;
                const isChecked = checkedItems[key];
                return (
                  <div
                    key={index}
                    className="flex items-start gap-4 p-2 rounded hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => toggleCheckbox(checklistLevel, index)}
                  >
                    <div className={`w-4 h-4 mt-0.5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      isChecked ? 'bg-green-500 border-green-500' : 'border-muted-foreground'
                    }`}>
                      {isChecked && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" viewBox="0 0 24 24" stroke="currentColor">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className={`text-xs leading-relaxed ${isChecked ? 'line-through text-muted-foreground' : ''}`}>
                      {item}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Emergency Contacts — horizontal grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4" />
            Emergency Contacts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="flex flex-col gap-2 p-4 bg-red-50 rounded-lg border border-red-100">
              <p className="font-semibold text-red-800 text-sm">Emergency Services</p>
              <p className="text-xs text-red-600">Fire, Police, Medical</p>
              <Button size="sm" variant="destructive" className="mt-auto">
                <Phone className="h-3 w-3 mr-1.5" />
                911
              </Button>
            </div>
            <div className="flex flex-col gap-2 p-4 border rounded-lg">
              <p className="font-semibold text-sm">Fire Department</p>
              <p className="text-xs text-muted-foreground">Non-emergency line</p>
              <Button size="sm" variant="outline" className="mt-auto">
                <Phone className="h-3 w-3 mr-1.5" />
                (555) 123-4567
              </Button>
            </div>
            <div className="flex flex-col gap-2 p-4 border rounded-lg">
              <p className="font-semibold text-sm">Evacuation Hotline</p>
              <p className="text-xs text-muted-foreground">24/7 information line</p>
              <Button size="sm" variant="outline" className="mt-auto">
                <Phone className="h-3 w-3 mr-1.5" />
                (555) 987-6543
              </Button>
            </div>
            <div className="flex flex-col gap-2 p-4 border rounded-lg">
              <p className="font-semibold text-sm">Red Cross Shelter</p>
              <p className="text-xs text-muted-foreground">Emergency assistance</p>
              <Button size="sm" variant="outline" className="mt-auto">
                <Phone className="h-3 w-3 mr-1.5" />
                (555) 456-7890
              </Button>
            </div>
          </div>
          <Alert className="mt-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Save these numbers in your phone and write them down — cell towers may be overloaded during emergencies.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

    </div>
  );
}