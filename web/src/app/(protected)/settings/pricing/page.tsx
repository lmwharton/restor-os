/**
 * /settings/pricing — recovery surface for the pricing upload.
 *
 * After a first successful upload the dashboard banner stops showing
 * automatically (server-derived `has_pricing`). We surface a one-line
 * confirmation here so users know it stuck.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import PricingUploadScreen from "@/app/(onboarding)/onboarding/screens/PricingUploadScreen";

export default function PricingSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activated, setActivated] = useState(false);

  function handleContinue() {
    // Bust the onboarding-status cache so the dashboard banner can update
    // on the next visit (in case the user navigates back).
    queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
    setActivated(true);
  }

  return (
    <div className="px-4 sm:px-6 pb-24 md:pb-12">
      <div className="max-w-[640px] mx-auto pt-8 sm:pt-10">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors mb-6"
        >
          <span aria-hidden>&larr;</span> Back to Settings
        </Link>

        <div className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04),0_8px_32px_rgba(31,27,23,0.08)] p-6 sm:p-8">
          {activated ? (
            <div className="space-y-4 text-center py-6">
              <div className="text-[40px]" aria-hidden>✅</div>
              <h2 className="text-[20px] font-bold text-on-surface">
                Pricing is now active
              </h2>
              <p className="text-[14px] text-on-surface-variant max-w-md mx-auto">
                Estimates will use your uploaded line-item prices going forward.
                Your &ldquo;Complete your setup&rdquo; banner has been retired.
              </p>
              <div className="pt-2 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => router.push("/dashboard")}
                  className="h-11 px-5 rounded-xl text-[13px] font-semibold text-on-primary bg-brand-accent hover:shadow-lg active:scale-[0.98] transition-all"
                >
                  Back to Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => setActivated(false)}
                  className="h-11 px-5 rounded-xl text-[13px] font-medium border border-outline-variant bg-white text-on-surface hover:bg-surface-container-low/50 transition-all"
                >
                  Upload Another
                </button>
              </div>
            </div>
          ) : (
            <PricingUploadScreen
              allowSkip={false}
              advanceOnboardingOnExit={false}
              onContinue={handleContinue}
              continueLabel="Done"
            />
          )}
        </div>
      </div>
    </div>
  );
}
