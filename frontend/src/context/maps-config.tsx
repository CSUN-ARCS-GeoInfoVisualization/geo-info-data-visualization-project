import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { APIProvider } from "@vis.gl/react-google-maps";

export type MapsConfigValue = {
  mapsApiKey: string | null;
  /** Reserved; always false (maps key is only from VITE_GOOGLE_MAPS_API_KEY at build time). */
  mapsKeyLoading: boolean;
};

const MapsConfigContext = createContext<MapsConfigValue>({
  mapsApiKey: null,
  mapsKeyLoading: false,
});

/**
 * Maps JS key comes only from VITE_GOOGLE_MAPS_API_KEY at build time.
 * (Server no longer exposes a maps key via /api/public/config.)
 */
export function MapsRuntimeProvider({ children }: { children: ReactNode }) {
  const mapsApiKey = useMemo(() => {
    const k = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? "";
    const t = k.trim();
    return t.length > 0 ? t : null;
  }, []);

  return (
    <MapsConfigContext.Provider value={{ mapsApiKey, mapsKeyLoading: false }}>
      <MaybeMapsApiProvider apiKey={mapsApiKey}>{children}</MaybeMapsApiProvider>
    </MapsConfigContext.Provider>
  );
}

export function useMapsConfig(): MapsConfigValue {
  return useContext(MapsConfigContext);
}

/** Loads Google Maps JS only when `apiKey` is non-empty — avoids NoApiKeys from an empty script URL. */
export function MaybeMapsApiProvider({
  apiKey,
  children,
}: {
  apiKey: string | null;
  children: ReactNode;
}) {
  if (apiKey) {
    return <APIProvider apiKey={apiKey}>{children}</APIProvider>;
  }
  return <>{children}</>;
}

/** Loading placeholder for map regions (e.g. future async key resolution). */
export function MapsKeyLoadingPlaceholder({
  className = "min-h-[240px]",
}: {
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center text-muted-foreground ${className}`}
    >
      <Loader2 className="h-8 w-8 animate-spin" aria-label="Loading map" />
    </div>
  );
}
