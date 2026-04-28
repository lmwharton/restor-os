/**
 * Wordmark used at the top of every onboarding wizard step. Mirrors the
 * /signup and /login mark so the journey feels like one continuous flow.
 *
 * Uses the official `crewmatic-logo.png` asset (lowercase wordmark with
 * water droplet over the i) — replaces the prior SVG-droplet + text combo.
 *
 * Pure presentation, no behavior — kept here (not in `components/`)
 * because no other surface needs this exact composition.
 */
"use client";

import Image from "next/image";

export function BrandHeader() {
  return (
    <div className="mb-7 flex items-center justify-center">
      <Image
        src="/crewmatic-logo.png"
        alt="Crewmatic"
        width={160}
        height={42}
        priority
        className="h-auto w-[140px] sm:w-[160px]"
      />
    </div>
  );
}
