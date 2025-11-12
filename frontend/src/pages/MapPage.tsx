// src/pages/MapPage.tsx
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import maplibregl, { Map } from "maplibre-gl";
import { api } from "../api/client";

type Pt = { lat: number; lon: number; risk: number };

export default function MapPage() {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  // --- helpers ---
  function toFeatureCollection(pts: Pt[]) {
    return {
      type: "FeatureCollection",
      features: pts.map((p) => ({
        type: "Feature",
        properties: { risk: p.risk },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] as [number, number] },
      })),
    };
  }

  function fitTo(fc: any) {
    if (!fc.features?.length || !mapRef.current) return;
    const bbox = fc.features.reduce(
      (b: [number, number, number, number] | null, f: any) => {
        const [x, y] = f.geometry.coordinates as [number, number];
        return b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
      },
      null
    );
    if (bbox) mapRef.current.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 500 });
  }

  async function reloadFor(date: string) {
    const map = mapRef.current;
    if (!map) return;
    const r = await api.get("/api/heatmap", { params: { date } });
    const fc = toFeatureCollection(r.data.points as Pt[]);
    const src = map.getSource("pts") as any;
    if (src?.setData) src.setData(fc);
    fitTo(fc);
  }

  function toggleHeatmap() {
    const map = mapRef.current!;
    const cur = (map.getLayoutProperty("pts-heat", "visibility") as "visible" | "none") ?? "none";
    const next = cur === "none" ? "visible" : "none";
    map.setLayoutProperty("pts-heat", "visibility", next);
    // dim circles when heatmap visible
    map.setPaintProperty("pts", "circle-opacity", next === "visible" ? 0.15 : 0.85);
  }

  function setHeatmapIntensity(v: number) {
    const map = mapRef.current!;
    map.setPaintProperty("pts-heat", "heatmap-intensity", v);
  }

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;

    // simple raster style (reliable)
    const style = {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }],
    } as const;

    const map = new maplibregl.Map({
      container: boxRef.current,
      style:"https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: [-119.5, 37.3],
      zoom: 5,
      trackResize: true,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", async () => {
      // initial data
      const r = await api.get("/api/heatmap", { params: { date: "2020-08-15" } });
      const fc = toFeatureCollection(r.data.points as Pt[]);

      map.addSource("pts", { type: "geojson", data: fc as any });

      // circles
      map.addLayer({
        id: "pts",
        type: "circle",
        source: "pts",
        paint: {
          "circle-radius": 4,
          "circle-color": [
            "interpolate", ["linear"], ["get", "risk"],
            0, "#2c7bb6", 0.5, "#fdae61", 1, "#d7191c",
          ],
          "circle-opacity": 0.85,
        },
      });

      // heatmap (hidden by default)
      map.addLayer({
        id: "pts-heat",
        type: "heatmap",
        source: "pts",
        maxzoom: 12,
        layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "risk"], 0, 0, 1, 1],
          "heatmap-intensity": 1,
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 5, 15, 12, 40],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "#2c7bb6",
            0.5, "#fdae61",
            0.8, "#d7191c",
          ],
        },
      });

      // tooltip
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      map.on("mousemove", "pts", (e) => {
        const f = e.features?.[0]; if (!f) return;
        const [x, y] = (f.geometry as any).coordinates;
        popup.setLngLat([x, y]).setHTML(`risk: ${(+f.properties.risk).toFixed(2)}`).addTo(map);
      });
      map.on("mouseleave", "pts", () => popup.remove());

      fitTo(fc);
    });

    map.on("error", (e) => console.error("MapLibre error:", e?.error || e));
    return () => map.remove();
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <div
        ref={boxRef}
        style={{ height: "85vh", width: "100%", position: "relative", border: "4px solid red" }}
      >
        {/* Date picker */}
        <input
          type="date"
          defaultValue="2020-08-15"
          onChange={(e) => reloadFor(e.target.value || "2020-08-15")}
          style={{ position: "absolute", zIndex: 10, top: 8, left: 8, padding: 6, background: "#fff",
                   border: "1px solid #ccc", borderRadius: 6 }}
        />

        {/* Heatmap toggle */}
        <button
          onClick={toggleHeatmap}
          style={{ position: "absolute", top: 670, right: 8, zIndex: 10, padding: "6px 10px" }}
        >
          Toggle Heatmap
        </button>

        {/* Heatmap intensity */}
        <div style={{ position: "absolute", top: 710, right: 8, zIndex: 10,
                      background: "#fff", border: "1px solid #ccc", borderRadius: 6, padding: 6 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>Intensity</div>
          <input
            type="range" min={0.5} max={3} step={0.1} defaultValue={1}
            onChange={(e) => setHeatmapIntensity(parseFloat(e.target.value))}
          />
        </div>

        {/* Legend */}
        <div
          style={{
            position: "absolute", left: 8, bottom: 8, zIndex: 10,
            background: "rgba(255,255,255,.9)", padding: "6px 8px", borderRadius: 6, fontSize: 12,
          }}
        >
          <b>Risk</b>
          <div
            style={{
              width: 160, height: 10, marginTop: 4,
              background: "linear-gradient(90deg,#2c7bb6,#fdae61,#d7191c)",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>0</span><span>0.5</span><span>1.0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
