import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { MapPin, Layers } from "lucide-react";
import { Button } from "./ui/button";
import { ImageWithFallback } from "./figma/ImageWithFallback";

export function MapPlaceholder() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Fire Risk Map
        </CardTitle>
        <Button variant="outline" size="sm">
          <Layers className="h-4 w-4 mr-2" />
          Layers
        </Button>
      </CardHeader>
      <CardContent>
        <div className="relative w-full h-80 bg-gradient-to-br from-green-100 via-yellow-100 to-red-100 rounded-lg overflow-hidden">
          <ImageWithFallback
            src="https://images.unsplash.com/photo-1606736349352-50647dad5adb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3aWxkZmlyZSUyMGZvcmVzdCUyMGFlcmlhbCUyMHZpZXd8ZW58MXx8fHwxNzU4MTMzMDE3fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral"
            alt="Aerial view of forest landscape"
            className="w-full h-full object-cover opacity-20"
          />
          
          {/* Risk level overlays */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-gray-600">
              <MapPin className="h-12 w-12 mx-auto mb-2 opacity-60" />
              <p className="text-sm font-medium">Interactive Risk Map</p>
              <p className="text-xs text-muted-foreground">
                Click to view detailed risk zones
              </p>
            </div>
          </div>

          {/* Mock risk zones */}
          <div className="absolute top-4 left-4 w-8 h-8 bg-red-500 rounded-full opacity-75 animate-pulse"></div>
          <div className="absolute top-12 right-8 w-6 h-6 bg-orange-500 rounded-full opacity-75"></div>
          <div className="absolute bottom-8 left-8 w-10 h-10 bg-yellow-500 rounded-full opacity-60"></div>
          <div className="absolute bottom-4 right-4 w-4 h-4 bg-green-500 rounded-full opacity-60"></div>

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <span>Extreme Risk</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                <span>High Risk</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <span>Moderate Risk</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span>Low Risk</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}