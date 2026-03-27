"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

const GoogleMapsContext = createContext(false);

export function useGoogleMapsLoaded() {
  return useContext(GoogleMapsContext);
}

export function GoogleMapsProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.warn("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set — address autocomplete disabled");
      return;
    }
    // Check if already loaded (e.g., hot reload)
    if (window.google?.maps?.places) {
      setLoaded(true);
      return;
    }
    setOptions({ key: apiKey, libraries: ["places"] });
    importLibrary("places").then(() => setLoaded(true));
  }, []);

  return (
    <GoogleMapsContext.Provider value={loaded}>
      {children}
    </GoogleMapsContext.Provider>
  );
}
