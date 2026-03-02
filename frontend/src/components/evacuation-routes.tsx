import { useState } from "react";
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
import { ImageWithFallback } from "./figma/ImageWithFallback";

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

      {/* Evacuation Map */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Evacuation Zone Map
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <ExternalLink className="h-4 w-4 mr-2" />
              Full Screen
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="relative w-full h-96 bg-gradient-to-br from-green-100 via-yellow-100 to-red-100 rounded-lg overflow-hidden">
            <ImageWithFallback
              src="https://images.unsplash.com/photo-1606736349352-50647dad5adb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3aWxkZmlyZSUyMGZvcmVzdCUyMGFlcmlhbCUyMHZpZXd8ZW58MXx8fHwxNzU4MTMzMDE3fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
              alt="Evacuation zone map overlay"
              className="w-full h-full object-cover opacity-30"
            />
            
            {/* Zone overlays */}
            <div className="absolute top-8 left-8 w-20 h-20 bg-red-500/60 rounded-lg flex items-center justify-center text-white font-bold">
              Zone A
            </div>
            <div className="absolute top-16 right-12 w-24 h-16 bg-orange-500/60 rounded-lg flex items-center justify-center text-white font-bold">
              Zone B
            </div>
            <div className="absolute bottom-12 left-16 w-28 h-20 bg-yellow-500/60 rounded-lg flex items-center justify-center text-white font-bold">
              Zone C
            </div>

            {/* Evacuation routes */}
            <div className="absolute top-1/2 left-1/4 w-2 h-32 bg-blue-600 transform -rotate-45 opacity-75"></div>
            <div className="absolute top-1/3 right-1/3 w-2 h-24 bg-blue-600 transform rotate-30 opacity-75"></div>

            {/* Assembly points */}
            <div className="absolute bottom-8 right-8 w-4 h-4 bg-green-600 rounded-full animate-pulse"></div>
            <div className="absolute bottom-16 right-20 w-4 h-4 bg-green-600 rounded-full animate-pulse"></div>
            
            {/* Map controls */}
            <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg p-2 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-600 rounded"></div>
                <span>Evacuation Routes</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-600 rounded-full"></div>
                <span>Assembly Points</span>
              </div>
            </div>
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