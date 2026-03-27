"use client";

import usePlacesAutocomplete, {
  getGeocode,
  getLatLng,
} from "use-places-autocomplete";
import { useRef, useEffect } from "react";
import { useGoogleMapsLoaded } from "./google-maps-provider";

export interface AddressParts {
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (parts: AddressParts) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

function parseAddressComponents(
  components: google.maps.GeocoderAddressComponent[]
): Omit<AddressParts, "latitude" | "longitude"> {
  let streetNumber = "";
  let route = "";
  let city = "";
  let state = "";
  let zip = "";

  for (const c of components) {
    const type = c.types[0];
    if (type === "street_number") streetNumber = c.long_name;
    else if (type === "route") route = c.short_name;
    else if (type === "locality") city = c.long_name;
    else if (type === "sublocality_level_1" && !city) city = c.long_name;
    else if (type === "administrative_area_level_1") state = c.short_name;
    else if (type === "postal_code") zip = c.long_name;
  }

  return {
    address_line1: streetNumber ? `${streetNumber} ${route}` : route,
    city,
    state,
    zip,
  };
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Start typing an address...",
  className,
  disabled = false,
}: AddressAutocompleteProps) {
  const isLoaded = useGoogleMapsLoaded();
  const listboxRef = useRef<HTMLUListElement>(null);

  const {
    ready,
    suggestions: { status, data },
    setValue,
    clearSuggestions,
    init,
  } = usePlacesAutocomplete({
    requestOptions: {
      componentRestrictions: { country: "us" },
      types: ["address"],
    },
    debounce: 250,
    initOnMount: false,
  });

  // Init when Google Maps loads
  useEffect(() => {
    if (isLoaded) {
      init();
    }
  }, [isLoaded, init]);

  function handleInput(val: string) {
    onChange(val);
    setValue(val);
  }

  async function handleSelect(description: string) {
    onChange(description);
    setValue(description, false);
    clearSuggestions();

    if (!onSelect) return;

    try {
      const results = await getGeocode({ address: description });
      const { lat, lng } = getLatLng(results[0]);
      const parts = parseAddressComponents(results[0].address_components);
      onSelect({
        ...parts,
        latitude: lat,
        longitude: lng,
      });
    } catch {
      // Geocode failed — still set the text
    }
  }

  const showSuggestions = status === "OK" && data.length > 0;

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => handleInput(e.target.value)}
        disabled={disabled || !ready}
        placeholder={!isLoaded ? "Loading..." : placeholder}
        className={className}
        role="combobox"
        aria-expanded={showSuggestions}
        aria-autocomplete="list"
        aria-controls="address-listbox"
        autoComplete="off"
      />
      {showSuggestions && (
        <ul
          id="address-listbox"
          ref={listboxRef}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto"
        >
          {data.map(({ place_id, structured_formatting }) => (
            <li
              key={place_id}
              role="option"
              aria-selected={false}
              onClick={() => handleSelect(structured_formatting.main_text + (structured_formatting.secondary_text ? ", " + structured_formatting.secondary_text : ""))}
              className="px-4 py-3 cursor-pointer hover:bg-surface-container-low transition-colors border-b border-outline-variant/30 last:border-0"
            >
              <span className="text-[15px] text-on-surface font-medium">
                {structured_formatting.main_text}
              </span>
              {structured_formatting.secondary_text && (
                <span className="text-[13px] text-on-surface-variant ml-1.5">
                  {structured_formatting.secondary_text}
                </span>
              )}
            </li>
          ))}
          <li className="px-4 py-2 text-[10px] text-on-surface-variant/50 text-right font-[family-name:var(--font-geist-mono)]">
            Powered by Google
          </li>
        </ul>
      )}
    </div>
  );
}
