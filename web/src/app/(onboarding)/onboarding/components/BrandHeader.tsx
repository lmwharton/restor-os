/**
 * Wordmark used at the top of every onboarding wizard step. Mirrors the
 * /signup and /login mark so the journey feels like one continuous flow.
 *
 * Pure presentation, no behavior — kept here (not in `components/`)
 * because no other surface needs this exact composition.
 */
"use client";

function WaterDropIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M14 3C14 3 6 12.5 6 17.5C6 22 9.58 25 14 25C18.42 25 22 22 22 17.5C22 12.5 14 3 14 3Z"
        fill="url(#wizardDropGrad)"
        stroke="#a63500"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="wizardDropGrad" x1="6" y1="3" x2="22" y2="25" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e85d26" stopOpacity="0.15" />
          <stop offset="1" stopColor="#a63500" stopOpacity="0.08" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BrandHeader() {
  return (
    <div className="mb-7 flex items-center justify-center gap-2.5">
      <WaterDropIcon />
      <span
        className="text-[17px] font-semibold lowercase"
        style={{ color: "#1f1b17", letterSpacing: "-0.45px" }}
      >
        crewmatic
      </span>
    </div>
  );
}
