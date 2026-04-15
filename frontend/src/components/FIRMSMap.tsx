import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { ScatterplotLayer } from '@deck.gl/layers';
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Flame, RefreshCw, Info } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { MapsKeyLoadingPlaceholder, useMapsConfig } from "../context/maps-config";
import { MapPlaceholder } from "./map-placeholder";
import { getApiBaseUrl } from "../config/apiBase";

// NASA FIRMS — VITE_FIRMS_API_KEY (Netlify build) or NASA_FIRMS_API_KEY on API server (/api/public/config)
const FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

// California bounding box: [west, south, east, north]
const CALIFORNIA_BOUNDS = '-125,32,-114,42';

interface ActiveFire {
  latitude: number;
  longitude: number;
  brightness: number;
  scan: number;
  track: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  confidence: number;
  version: string;
  bright_t31: number;
  frp: number; // Fire Radiative Power
  daynight: string;
}

// Parse CSV response from FIRMS API
function parseCSV(csv: string): ActiveFire[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  const fires: ActiveFire[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length < headers.length) continue;

    const fire: any = {};
    headers.forEach((header, index) => {
      const value = values[index];
      // Convert numeric fields
      if (['latitude', 'longitude', 'brightness', 'scan', 'track', 'confidence', 'bright_t31', 'frp'].includes(header)) {
        fire[header] = parseFloat(value);
      } else {
        fire[header] = value;
      }
    });

    fires.push(fire as ActiveFire);
  }

  return fires;
}

// Active Fires Overlay Component
function ActiveFiresOverlay({
  fires,
  enabled
}: {
  fires: ActiveFire[];
  enabled: boolean;
}) {
  const map = useMap();
  const [overlay, setOverlay] = useState<GoogleMapsOverlay | null>(null);
  const [hoveredFire, setHoveredFire] = useState<ActiveFire | null>(null);

  useEffect(() => {
    if (!map || !enabled) {
      if (overlay) {
        overlay.setMap(null);
        overlay.finalize();
        setOverlay(null);
      }
      return;
    }

    // Clean up old overlay
    if (overlay) {
      overlay.setMap(null);
      overlay.finalize();
    }

    // Create scatter plot layer for active fires
    const deckOverlay = new GoogleMapsOverlay({
      layers: [
        new ScatterplotLayer({
          id: 'active-fires',
          data: fires,
          pickable: true,
          opacity: 0.8,
          stroked: true,
          filled: true,
          radiusScale: 1,
          radiusMinPixels: 3,
          radiusMaxPixels: 30,
          lineWidthMinPixels: 1,

          getPosition: (d: ActiveFire) => [d.longitude, d.latitude],

          // Size based on Fire Radiative Power (FRP)
          getRadius: (d: ActiveFire) => Math.sqrt(d.frp) * 500,

          // Color based on confidence level
          getFillColor: (d: ActiveFire) => {
            if (d.confidence >= 80) return [220, 38, 38, 200]; // High confidence - bright red
            if (d.confidence >= 50) return [249, 115, 22, 200]; // Medium confidence - orange
            return [234, 179, 8, 200]; // Low confidence - yellow
          },

          getLineColor: [255, 255, 255, 255],
          getLineWidth: 2,

          // Hover handler
          onHover: (info: any) => {
            if (info.object) {
              setHoveredFire(info.object);
            } else {
              setHoveredFire(null);
            }
          },

          // Animation
          updateTriggers: {
            getRadius: [fires],
            getFillColor: [fires]
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
  }, [map, fires, enabled]);

  // Render hover tooltip
  if (hoveredFire) {
    return (
      <div
        style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          color: 'white',
          padding: '12px',
          borderRadius: '6px',
          fontSize: '13px',
          zIndex: 1000,
          pointerEvents: 'none',
          maxWidth: '280px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
        }}
      >
        <div className="font-bold mb-2 flex items-center gap-2">
          <Flame className="h-4 w-4" />
          Active Fire Detection
        </div>
        <div className="space-y-1 text-xs">
          <div><strong>Satellite:</strong> {hoveredFire.satellite || 'N/A'}</div>
          <div><strong>Confidence:</strong> {hoveredFire.confidence ? `${hoveredFire.confidence}%` : 'N/A'}</div>
          <div><strong>Brightness:</strong> {hoveredFire.brightness ? `${hoveredFire.brightness.toFixed(1)}K` : 'N/A'}</div>
          <div><strong>FRP:</strong> {hoveredFire.frp ? `${hoveredFire.frp.toFixed(1)} MW` : 'N/A'}</div>
          <div><strong>Date:</strong> {hoveredFire.acq_date || 'N/A'}</div>
          <div><strong>Time:</strong> {hoveredFire.acq_time ? `${hoveredFire.acq_time.slice(0, 2)}:${hoveredFire.acq_time.slice(2)}` : 'N/A'}</div>
          <div><strong>Day/Night:</strong> {hoveredFire.daynight === 'D' ? 'Day' : hoveredFire.daynight === 'N' ? 'Night' : 'N/A'}</div>
        </div>
      </div>
    );
  }

  return null;
}

export function FIRMSMap() {
  const { mapsApiKey, mapsKeyLoading } = useMapsConfig();
  const envFirms = useMemo(
    () => ((import.meta.env.VITE_FIRMS_API_KEY as string | undefined) ?? "").trim(),
    []
  );
  const apiBase = getApiBaseUrl();
  const [remoteFirmsKey, setRemoteFirmsKey] = useState<string | null>(null);
  const [firmsConfigReady, setFirmsConfigReady] = useState(() => {
    if (envFirms) return true;
    return !apiBase;
  });

  const firmsApiKey = envFirms || remoteFirmsKey || "";

  useEffect(() => {
    if (envFirms) return;
    if (!apiBase) return;
    let cancelled = false;
    fetch(`${apiBase}/public/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { firms_api_key?: string } | null) => {
        if (cancelled || !data) return;
        const k = (data.firms_api_key ?? "").trim();
        setRemoteFirmsKey(k.length > 0 ? k : null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFirmsConfigReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [envFirms, apiBase]);

  const [fires, setFires] = useState<ActiveFire[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showFires, setShowFires] = useState(true);
  const [dayRange, setDayRange] = useState(1); // Day range selector

  const fetchActiveFires = useCallback(async () => {
    setLoading(true);

    try {
      const key = firmsApiKey.trim();
      if (!key) {
        setFires([]);
        setLoading(false);
        return;
      }
      const url = `${FIRMS_BASE_URL}/${key}/VIIRS_SNPP_NRT/${CALIFORNIA_BOUNDS}/${dayRange}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const csv = await response.text();

      if (csv.includes("Invalid") || csv.includes("Error")) {
        throw new Error("Invalid API key or request.");
      }

      if (csv.trim().split("\n").length <= 1) {
        setFires([]);
        setLastUpdate(new Date());
        setLoading(false);
        return;
      }

      const parsedFires = parseCSV(csv);
      setFires(parsedFires);
      setLastUpdate(new Date());
    } catch {
      setFires([]);
    } finally {
      setLoading(false);
    }
  }, [firmsApiKey, dayRange]);

  useEffect(() => {
    if (!firmsConfigReady) return;
    fetchActiveFires();
  }, [firmsConfigReady, fetchActiveFires]);

  const highConfidenceFires = fires.filter(f => f.confidence >= 80).length;
  const mediumConfidenceFires = fires.filter(f => f.confidence >= 50 && f.confidence < 80).length;
  const lowConfidenceFires = fires.filter(f => f.confidence < 50).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-red-500" />
            Active Fires (NASA FIRMS)
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Day Range Selector */}
            <select
              value={dayRange}
              onChange={(e) => setDayRange(Number(e.target.value))}
              className="text-sm border rounded px-2 py-1"
              disabled={loading}
            >
              <option value={1}>Last 24 hours</option>
              <option value={2}>Last 2 days</option>
              <option value={3}>Last 3 days</option>
              <option value={5}>Last 5 days</option>
            </select>

            {loading && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchActiveFires}
              disabled={loading}
              title="Refresh data"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="flex gap-2 mt-2 flex-wrap">
          <Badge variant="destructive" className="flex items-center gap-1">
            <span className="font-bold">{fires.length}</span> Total Detections
          </Badge>
          {highConfidenceFires > 0 && (
            <Badge className="bg-red-600">
              {highConfidenceFires} High Confidence
            </Badge>
          )}
          {mediumConfidenceFires > 0 && (
            <Badge className="bg-orange-500">
              {mediumConfidenceFires} Medium
            </Badge>
          )}
          {lowConfidenceFires > 0 && (
            <Badge className="bg-yellow-500">
              {lowConfidenceFires} Low
            </Badge>
          )}
        </div>

        {lastUpdate && (
          <p className="text-xs text-muted-foreground mt-2">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </p>
        )}
      </CardHeader>

      <CardContent>
        {/* Map or fallback (no Google Maps key = no script / no useMap) */}
        <div className="w-full min-h-96 rounded-lg overflow-hidden border relative">
          {mapsKeyLoading && (
            <MapsKeyLoadingPlaceholder className="min-h-96 w-full absolute inset-0 bg-background/80 z-20" />
          )}
          {fires.length === 0 && !loading && mapsApiKey && !mapsKeyLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/10 z-10 pointer-events-none">
              <div className="bg-white px-6 py-3 rounded-lg shadow-lg text-center">
                <p className="text-lg font-semibold text-green-600">✅ No Active Fires Detected</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No fires detected in California in the last {dayRange} day{dayRange > 1 ? 's' : ''}
                </p>
              </div>
            </div>
          )}

          {!mapsApiKey && !mapsKeyLoading ? (
            <MapPlaceholder className="min-h-96 w-full" />
          ) : mapsApiKey ? (
            <div className="h-96 w-full relative">
              <GoogleMap
                style={{ width: '100%', height: '100%' }}
                defaultCenter={{ lat: 36.7, lng: -119.8 }}
                defaultZoom={6}
                mapTypeId="satellite"
                gestureHandling="greedy"
                disableDefaultUI={false}
              >
                <ActiveFiresOverlay fires={fires} enabled={showFires} />
              </GoogleMap>
            </div>
          ) : null}
        </div>

        {/* Legend */}
        <div className="mt-3 bg-gray-50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-sm">
              Active Fire Detections ({dayRange} day{dayRange > 1 ? 's' : ''})
            </h4>
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-600 rounded-full"></div>
              <span>H = High (80%+)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
              <span>N = Nominal (50-80%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <span>L = Low (&lt;50%)</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            💡 Hover fires for details. Data from NASA VIIRS satellite. Active fire/thermal anomalies may be from fire, hot smoke, agriculture or other sources
          </p>
        </div>
      </CardContent>
    </Card>
  );
}