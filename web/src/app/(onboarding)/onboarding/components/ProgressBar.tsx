/**
 * Sticky onboarding progress bar — `Step X of N: Title`.
 *
 * Stays at the top of every step screen (NOT the Welcome screen — that
 * has its own celebratory layout). Mobile-friendly: full-width, bold but
 * compact. The bar fill itself is the brand-orange accent.
 *
 * Wizard currently runs as 2 steps (Company Profile, Pricing). The
 * `totalSteps` prop is used so a future change (e.g. adding a step back)
 * doesn't require touching the title array order.
 */
"use client";

const STEP_TITLES = [
  "Company Profile",
  "Pricing Setup (Optional)",
] as const;

export function ProgressBar({
  current,
  totalSteps = 2,
}: {
  /** Which step is currently in view. */
  current: 1 | 2;
  /** Total step count — defaults to 2 to match the current wizard. */
  totalSteps?: number;
}) {
  const pct = (current / totalSteps) * 100;
  const title = STEP_TITLES[current - 1];

  return (
    <div className="sticky top-0 z-40 -mx-6 -mt-10 mb-8 sm:-mx-10 sm:-mt-10">
      <div
        className="border-b px-6 py-4 sm:px-10"
        style={{
          backgroundColor: "#fffaf6",
          borderColor: "#f0d6c5",
          boxShadow: "0 1px 0 rgba(166, 53, 0, 0.04)",
        }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.12em] font-[family-name:var(--font-geist-mono)]"
            style={{ color: "#a63500" }}
          >
            Step {current} of {totalSteps}
          </p>
          <p className="text-[12px] font-medium truncate" style={{ color: "#594139" }}>
            {title}
          </p>
        </div>
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: "#f3dcce" }}
          aria-hidden="true"
        >
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={totalSteps}
            aria-valuenow={current}
            aria-valuetext={`Step ${current} of ${totalSteps}: ${title}`}
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%`, backgroundColor: "#e85d26" }}
          />
        </div>
      </div>
    </div>
  );
}
