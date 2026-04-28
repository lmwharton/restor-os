"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { importLibrary } from "@googlemaps/js-api-loader";
import { useGoogleMapsLoaded } from "@/components/google-maps-provider";
import { STATUS_COLORS } from "@/lib/status-colors";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

interface MapJob {
  id: string;
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  stage: string;
  stageLabel: string;
  color: string;
  customerName: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface DashboardMapProps {
  jobs: MapJob[];
  selectedStage: string | null;
}

// Dark map style that matches the dashboard aesthetic
// Light map style matching the dashboard surface colors
const MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#f5f0eb" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#78716c" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#faf8f5" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#e7e0d9" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#e7e0d9" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#a8a29e" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#f0e8e0" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#e7e0d9" }] },
  { featureType: "road.local", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#dce8f0" }] },
  { featureType: "water", elementType: "labels", stylers: [{ visibility: "off" }] },
];

// US center as default
const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 };
const DEFAULT_ZOOM = 4;

// Global geocode cache — survives component unmount/remount across navigations
const geocodeCache = new Map<string, google.maps.LatLngLiteral | null>();

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function DashboardMap({ jobs, selectedStage }: DashboardMapProps) {
  const mapsLoaded = useGoogleMapsLoaded();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  // Use global cache instead of ref so geocodes persist across navigations
  const [geocoding, setGeocoding] = useState(false);
  const [ready, setReady] = useState(false);

  // Initialize the map
  useEffect(() => {
    if (!mapsLoaded || !mapRef.current || mapInstanceRef.current) return;

    let cancelled = false;

    async function initMap() {
      const { Map: GoogleMap } = await importLibrary("maps") as google.maps.MapsLibrary;
      const { InfoWindow } = await importLibrary("maps") as google.maps.MapsLibrary;

      if (cancelled || !mapRef.current) return;

      const map = new GoogleMap(mapRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        styles: MAP_STYLES,
        disableDefaultUI: true,
        zoomControl: true,
        zoomControlOptions: {
          position: google.maps.ControlPosition.RIGHT_TOP,
        },
        gestureHandling: "cooperative",
        backgroundColor: "#f5f0eb",
      });

      mapInstanceRef.current = map;
      infoWindowRef.current = new InfoWindow();
      setReady(true);
    }

    initMap();
    return () => { cancelled = true; };
  }, [mapsLoaded]);

  // Geocode and place markers when jobs change
  const placeMarkers = useCallback(async () => {
    const map = mapInstanceRef.current;
    if (!map || !ready) return;

    setGeocoding(true);

    // Clear existing markers
    for (const marker of markersRef.current) {
      marker.setMap(null);
    }
    markersRef.current = [];

    const { Geocoder } = await importLibrary("geocoding") as google.maps.GeocodingLibrary;
    const geocoder = new Geocoder();

    const bounds = new google.maps.LatLngBounds();
    let hasValidMarker = false;

    for (const job of jobs) {
      const addressStr = [job.address_line1, job.city, job.state, job.zip]
        .filter(Boolean)
        .join(", ");

      if (!addressStr.trim()) continue;

      // Use DB lat/lng if available (skips geocoding entirely)
      let position: google.maps.LatLngLiteral | null | undefined;
      if (job.latitude && job.longitude) {
        position = { lat: job.latitude, lng: job.longitude };
      } else {
        position = geocodeCache.get(addressStr);
      }

      // Geocode only if no lat/lng and not cached
      if (position === undefined) {
        try {
          const result = await geocoder.geocode({ address: addressStr });
          if (result.results.length > 0) {
            const loc = result.results[0].geometry.location;
            position = { lat: loc.lat(), lng: loc.lng() };
            geocodeCache.set(addressStr, position);
          } else {
            geocodeCache.set(addressStr, null);
            position = null;
          }
        } catch {
          geocodeCache.set(addressStr, null);
          position = null;
        }
      }

      if (!position) continue;

      // Offset overlapping pins at the same location
      const posKey = `${position.lat.toFixed(4)},${position.lng.toFixed(4)}`;
      const existing = markersRef.current.filter((_, idx) => {
        const prevJob = jobs[idx];
        if (!prevJob) return false;
        const prevAddr = [prevJob.address_line1, prevJob.city, prevJob.state, prevJob.zip].filter(Boolean).join(", ");
        const prevPos = geocodeCache.get(prevAddr);
        if (!prevPos) return false;
        return `${prevPos.lat.toFixed(4)},${prevPos.lng.toFixed(4)}` === posKey;
      }).length;
      if (existing > 0) {
        const angle = (existing * 60) * (Math.PI / 180);
        const offset = 0.0003;
        position = { lat: position.lat + Math.cos(angle) * offset, lng: position.lng + Math.sin(angle) * offset };
      }

      // Spec 01K, Option A — disputed is the only "act now" alarm color in
      // the palette. Saturated red-orange fill (--status-disputed) + 3px
      // brand-orange ring (--status-active) makes it read as live alert,
      // distinct from on-hold's quiet amber. "!" glyph inside the pin.
      const isDisputed = job.stage === "disputed";
      const markerOpts: google.maps.MarkerOptions = {
        map,
        position,
        title: job.address_line1,
        icon: isDisputed
          ? {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 9,
              // Google Maps SymbolPath doesn't consume CSS vars, so we
              // import STATUS_COLORS to keep this in lockstep with
              // labels.ts STATUS_META — palette flips propagate here too.
              fillColor: STATUS_COLORS.disputed,
              fillOpacity: 1,
              strokeColor: STATUS_COLORS.active,
              strokeWeight: 3,
            }
          : {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: job.color,
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
      };
      if (isDisputed) {
        markerOpts.label = { text: "!", color: "#fff", fontSize: "12px", fontWeight: "700" };
      }
      const marker = new google.maps.Marker(markerOpts);

      // Click pin to show info window, click again or click link to navigate
      marker.addListener("click", () => {
        const infoWindow = infoWindowRef.current;
        if (!infoWindow) return;
        infoWindow.setContent(`
          <div style="font-family:system-ui,-apple-system,sans-serif;padding:4px 2px;">
            <div style="font-weight:600;font-size:13px;color:#1c1917;line-height:1.3;">${job.address_line1}</div>
            <div style="font-size:11px;color:#78716c;margin-top:3px;">${job.customerName || job.city + ", " + job.state}</div>
            <a href="/jobs/${job.id}" style="display:inline-block;margin-top:6px;font-size:11px;font-weight:600;color:${STATUS_COLORS.active};text-decoration:underline;text-underline-offset:2px;">Open Job &rarr;</a>
          </div>
        `);
        infoWindow.open({ anchor: marker, map });
      });

      markersRef.current.push(marker);
      bounds.extend(position);
      hasValidMarker = true;
    }

    // Fit bounds if we have markers
    if (hasValidMarker) {
      map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
      // Don't zoom in too much for a single marker
      const listener = google.maps.event.addListener(map, "idle", () => {
        const currentZoom = map.getZoom();
        if (currentZoom !== undefined && currentZoom > 14) {
          map.setZoom(14);
        }
        google.maps.event.removeListener(listener);
      });
    }

    setGeocoding(false);
  }, [jobs, ready]);

  useEffect(() => {
    placeMarkers();
  }, [placeMarkers]);

  // Update marker visibility when selectedStage changes
  useEffect(() => {
    markersRef.current.forEach((marker, i) => {
      const job = jobs[i];
      if (!job) return;
      const isMatch = selectedStage === null || job.stage === selectedStage;
      marker.setOpacity(isMatch ? 1 : 0.25);
    });
  }, [selectedStage, jobs]);

  // Loading state when maps haven't loaded yet
  if (!mapsLoaded) {
    return (
      <div className="relative min-h-[400px] h-full flex-1 bg-surface-container-high rounded-xl overflow-hidden flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-outline-variant border-t-brand-accent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-[11px] text-outline font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em]">
            Loading map
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[400px] h-full flex-1 rounded-xl overflow-hidden">
      <div ref={mapRef} className="absolute inset-0" />
      {geocoding && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-surface-container-lowest/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-sm">
          <div className="w-3 h-3 border-2 border-outline-variant border-t-brand-accent rounded-full animate-spin" />
          <span className="text-[10px] text-outline font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.1em]">
            Locating jobs
          </span>
        </div>
      )}
    </div>
  );
}
