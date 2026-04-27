/**
 * Onboarding Welcome — final celebratory screen.
 *
 * Shows a checklist of completed (✓) vs. skipped (○) items and a "Next
 * steps" rundown. CTA goes to /dashboard, not /jobs (per spec).
 *
 * Note: pricing-checked status is server-derived (`has_pricing`), so a
 * user who skipped pricing this session may still see ✓ if they uploaded
 * earlier and bailed before this screen rendered. That's correct.
 */
"use client";

import { useRouter } from "next/navigation";
import { PrimaryButton } from "../components/UiBits";

type Props = {
  createdJob: boolean;
  hasPricing: boolean;
};

export default function WelcomeScreen({ createdJob, hasPricing }: Props) {
  const router = useRouter();

  const items = [
    { done: true, label: "Company profile created" },
    { done: createdJob, label: "First job created" },
    { done: hasPricing, label: "Pricing setup" },
  ];

  return (
    <div className="space-y-7 text-center sm:text-left">
      <div>
        <p className="text-[40px] sm:text-[48px] leading-none mb-3" aria-hidden>🎉</p>
        <h1 className="text-[28px] sm:text-[32px] font-bold leading-tight" style={{ color: "#1f1b17" }}>
          Welcome to Crewmatic!
        </h1>
        <p className="mt-2 text-[14px] sm:text-[15px] leading-relaxed" style={{ color: "#594139" }}>
          Your account is set up and ready. Here&apos;s what you&apos;ve done so far:
        </p>
      </div>

      <ul className="space-y-2.5 text-left">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
              style={{
                backgroundColor: item.done ? "#15512c" : "#f3dcce",
                color: item.done ? "white" : "#a63500",
              }}
            >
              {item.done ? "✓" : "○"}
            </span>
            <span
              className="text-[14px]"
              style={{ color: item.done ? "#1f1b17" : "#594139" }}
            >
              {item.label}
              {!item.done ? (
                <span className="ml-1.5 text-[12px]" style={{ color: "#8d7168" }}>
                  (optional — do it anytime)
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      <div
        className="rounded-xl border p-4 text-left"
        style={{ borderColor: "#e1bfb4", backgroundColor: "#fffaf6" }}
      >
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.12em] font-[family-name:var(--font-geist-mono)]"
          style={{ color: "#a63500" }}
        >
          Next steps
        </p>
        <ul className="mt-2 space-y-1 text-[13px]" style={{ color: "#1f1b17" }}>
          <li className="flex gap-2"><span aria-hidden>•</span> Add photos and damage documentation</li>
          <li className="flex gap-2"><span aria-hidden>•</span> Create an estimate from your photos</li>
          <li className="flex gap-2"><span aria-hidden>•</span> Explore the dashboard for live job status</li>
        </ul>
      </div>

      <div className="flex justify-center sm:justify-end pt-2">
        <PrimaryButton type="button" onClick={() => router.push("/dashboard")}>
          Go to Dashboard
          <span aria-hidden className="text-[16px]">&rarr;</span>
        </PrimaryButton>
      </div>
    </div>
  );
}
