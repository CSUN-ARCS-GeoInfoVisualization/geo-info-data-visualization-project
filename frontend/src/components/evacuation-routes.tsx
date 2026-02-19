import { useState, useEffect } from "react";
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
function FireFacilitiesOverlay() {
  const map = useMap();
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null);
  const [tooltip, setTooltip] = useState<any>(null);
  const [facilitiesData, setFacilitiesData] = useState<any[]>([]);
  const [clusteredData, setClusteredData] = useState<any[]>([]);
  const [zoom, setZoom] = useState(8);
  const [isClickDisabled, setIsClickDisabled] = useState(false);

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
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [tooltip]);

  // Update clusters when zoom changes
  useEffect(() => {
    if (!map || facilitiesData.length === 0) return;

    const updateClusters = () => {
      const currentZoom = Math.floor(map.getZoom() || 8);
      setZoom(currentZoom);

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
  }, [map, facilitiesData]);

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
              // Cluster icon with count
              return {
                url: `data:image/svg+xml;utf8,${encodeURIComponent(`
                  <svg width="50" height="50" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="25" cy="25" r="22" fill="rgb(59, 130, 246)" stroke="white" stroke-width="3"/>
                    <text x="25" y="32" font-size="16" font-weight="bold" text-anchor="middle" fill="white">${pointCount}</text>
                  </svg>
                `)}`,
                width: 50,
                height: 50,
                anchorY: 50
              };
            } else {
              // Individual shelter icon
              const style = getFacilityStyle(d.properties.facility_usage_code, d.properties.facility_type);
              return {
                url: `data:image/svg+xml;utf8,${encodeURIComponent(`
                  <svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="20" cy="20" r="16" fill="rgb(${style.color.join(',')})" stroke="white" stroke-width="2"/>
                    <text x="20" y="27" font-size="18" text-anchor="middle" fill="white">${style.icon}</text>
                  </svg>
                `)}`,
                width: 40,
                height: 40,
                anchorY: 40
              };
            }
          },

          getSize: (d: any) => {
            const isCluster = d.properties.cluster;
            const pointCount = d.properties.point_count || 1;

            if (isCluster) {
              // Scale cluster size based on point count
              return Math.min(50 + (pointCount / 10), 80);
            }
            return 40;
          },

          onClick: (info: any) => {
            if (info.object && !isClickDisabled) {
              // Disable clicks temporarily
              setIsClickDisabled(true);
              setTimeout(() => setIsClickDisabled(false), 300);

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
    </>
  );
}

export function EvacuationRoutes() {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [checklistLevel, setChecklistLevel] = useState<'prepare' | 'fireWatch' | 'evacuationWarning' | 'evacuateNow'>('prepare');
  const [checkedItems, setCheckedItems] = useState<{[key: string]: boolean}>({});

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
          <h1 className="text-3xl font-bold mb-2">Evacuation Routes</h1>
          <p className="text-muted-foreground">
            Current evacuation zones, routes, and emergency assembly points
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Navigation className="h-4 w-4 mr-2" />
            Get Directions
          </Button>
          <Button size="sm">
            <Phone className="h-4 w-4 mr-2" />
            Emergency: 911
          </Button>
        </div>
      </div>

      {/* Emergency Alert */}
      <Alert className="border-l-4 border-l-red-500 bg-red-50">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <div className="flex items-center justify-between">
            <div>
              <strong>Active Evacuation Order:</strong> Zone A residents must evacuate immediately.
              Take Highway 101 North or Mountain View Road.
            </div>
            <Button size="sm" variant="destructive">
              View Details
            </Button>
          </div>
        </AlertDescription>
      </Alert>

      {/* Interactive Map with Fire Facilities */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Interactive Evacuation Zone Map
          </CardTitle>
          <div className="flex gap-2">
            {/*<Button variant="outline" size="sm">
              <ExternalLink className="h-4 w-4 mr-2" />
              Full Screen
            </Button>*/}
          </div>
        </CardHeader>
        <CardContent>
          {/* Google Map with Deck.gl Overlay */}
          <div className="w-full h-96 rounded-lg overflow-hidden border">
            <Map
              style={{ width: '100%', height: '100%' }}
              defaultCenter={{ lat: 38.7, lng: -120.8 }}
              defaultZoom={8}
              gestureHandling="greedy"
              disableDefaultUI={false}
            >
              <FireFacilitiesOverlay />
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