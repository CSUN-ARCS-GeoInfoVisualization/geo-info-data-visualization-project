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

const safetyChecklist = [
  "Create a family evacuation plan",
  "Prepare emergency supply kit",
  "Know your evacuation zone",
  "Identify multiple evacuation routes",
  "Plan for pets and livestock",
  "Keep important documents accessible",
  "Maintain full fuel tank",
  "Download emergency apps"
];

// Deck.gl overlay component with clustering
function FireFacilitiesOverlay() {
  const map = useMap();
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null);
  const [tooltip, setTooltip] = useState<any>(null);
  const [facilitiesData, setFacilitiesData] = useState<any[]>([]);
  const [clusteredData, setClusteredData] = useState<any[]>([]);
  const [zoom, setZoom] = useState(8);

  // Facility type icons and colors
  const getFacilityStyle = (type: string) => {
    const styles: { [key: string]: { icon: string; color: [number, number, number] } } = {
      'FSB': { icon: '🚒', color: [220, 38, 38] },
      'FSA': { icon: '🚒', color: [249, 115, 22] },
      'FSAB': { icon: '🚒', color: [234, 179, 8] },
      'HQ': { icon: '🏢', color: [59, 130, 246] },
      'COM': { icon: '📡', color: [147, 51, 234] },
      'HB': { icon: '🚁', color: [236, 72, 153] },
      'AAB': { icon: '✈️', color: [14, 165, 233] },
      'ECC': { icon: '🎯', color: [239, 68, 68] },
      'LO': { icon: '👁️', color: [251, 191, 36] },
      'TC': { icon: '🎓', color: [20, 184, 166] },
      'CC': { icon: '⛺', color: [34, 197, 94] },
    };
    return styles[type] || { icon: '📍', color: [156, 163, 175] };
  };

  const getFacilityTypeName = (type: string) => {
    const names: { [key: string]: string } = {
      'FSB': 'Fire Station (State)',
      'FSA': 'Fire Station (Amador)',
      'FSAB': 'Fire Station (Assisted)',
      'HQ': 'Headquarters',
      'COM': 'Communication Site',
      'HB': 'Helibase',
      'AAB': 'Air Attack Base',
      'ECC': 'Emergency Command Center',
      'LO': 'Lookout Tower',
      'TC': 'Training Center',
      'CC': 'Conservation Camp',
    };
    return names[type] || type;
  };

  // Load GeoJSON data
  useEffect(() => {
    fetch('/Data/Facilities_for_Wildland_Fire_Protection.geojson')
      .then(response => response.json())
      .then(data => {
        console.log('Loaded facilities:', data.features.length);
        const activeFeatures = data.features.filter(
          (f: any) => f.properties.FACILITY_STATUS === 'Active'
        );
        setFacilitiesData(activeFeatures);
      })
      .catch(error => {
        console.error('Error loading facilities:', error);
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

    // Create deck.gl overlay
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
              // Individual facility icon
              const style = getFacilityStyle(d.properties.TYPE);
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
            if (info.object) {
              const isCluster = info.object.properties.cluster;

              if (isCluster) {
                // Zoom into cluster
                const clusterId = info.object.properties.cluster_id;
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
                // Show tooltip for individual facility
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
      deckOverlay.setMap(null);
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
              {tooltip.content.NAME}
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              {getFacilityTypeName(tooltip.content.TYPE)}
            </div>
          </div>

          <div style={{ fontSize: '12px', lineHeight: '1.6' }}>
            {tooltip.content.COUNTY && (
              <div><strong>County:</strong> {tooltip.content.COUNTY}</div>
            )}
            {tooltip.content.ADDRESS && (
              <div><strong>Address:</strong> {tooltip.content.ADDRESS}</div>
            )}
            {tooltip.content.CITY && (
              <div><strong>City:</strong> {tooltip.content.CITY} {tooltip.content.ZIP}</div>
            )}
            {tooltip.content.PHONE_NUM && (
              <div><strong>Phone:</strong> {tooltip.content.PHONE_NUM}</div>
            )}
            {tooltip.content.OWNER && (
              <div><strong>Owner:</strong> {tooltip.content.OWNER}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function EvacuationRoutes() {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

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
            <Button variant="outline" size="sm">
              <ExternalLink className="h-4 w-4 mr-2" />
              Full Screen
            </Button>
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
          <div className="mt-4 bg-gray-50 rounded-lg p-3">
            <h4 className="font-semibold text-sm mb-3">Map Legend</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                  5
                </div>
                <span>Facility Cluster</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-600 rounded-full"></div>
                <span>Fire Stations</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span>Headquarters</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-purple-600 rounded-full"></div>
                <span>Communication Sites</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-pink-500 rounded-full"></div>
                <span>Helibases</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-amber-400 rounded-full"></div>
                <span>Lookout Towers</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-teal-500 rounded-full"></div>
                <span>Training Centers</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              💡 Click clusters (blue circles with numbers) to zoom in. Click individual facilities for details.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Evacuation Zones and Assembly Points Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Evacuation Zones */}
        <Card>
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
        </Card>

        {/* Assembly Points */}
        <Card>
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
        </Card>
      </div>

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
            <div className="space-y-3">
              {safetyChecklist.map((item, index) => (
                <div key={index} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
                  <div className="w-5 h-5 rounded border-2 border-muted-foreground flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground opacity-0 hover:opacity-100 transition-opacity"></div>
                  </div>
                  <span className="text-sm">{item}</span>
                </div>
              ))}
            </div>
            <Button className="w-full mt-4" variant="outline">
              Download Full Emergency Plan
            </Button>
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