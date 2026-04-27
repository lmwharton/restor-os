/**
 * /settings/jobs/import — recovery surface for Quick-Add Jobs.
 *
 * Available regardless of onboarding state. After a successful batch
 * import, redirects to /jobs with a toast (passed via search params so
 * the jobs list can render the success line). For now we keep the toast
 * client-local — the jobs page already lists imported jobs once
 * navigation completes.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import QuickAddJobsScreen from "@/app/(onboarding)/onboarding/screens/QuickAddJobsScreen";

export default function ImportJobsSettingsPage() {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);

  function handleImported(count: number) {
    // Surface the count briefly, then route to the jobs list. Using
    // window.sessionStorage so /jobs can pick it up on next render
    // without us building a global toast bus.
    try {
      window.sessionStorage.setItem(
        "crewmatic.import.toast",
        `${count} job${count === 1 ? "" : "s"} imported`,
      );
    } catch {
      // Ignore — user has storage disabled; toast still appears here.
    }
    setToast(`${count} job${count === 1 ? "" : "s"} imported`);
    router.push("/jobs");
  }

  function handleCancel() {
    router.push("/settings");
  }

  return (
    <div className="px-4 sm:px-6 pb-24 md:pb-12">
      <div className="max-w-[720px] mx-auto pt-8 sm:pt-10">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors mb-6"
        >
          <span aria-hidden>&larr;</span> Back to Settings
        </Link>

        <div className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04),0_8px_32px_rgba(31,27,23,0.08)] p-6 sm:p-8">
          <QuickAddJobsScreen
            heading="Import Active Jobs"
            subheading="Add up to 10 in-flight jobs in a single batch. They land in your pipeline immediately."
            cancelLabel="Cancel"
            submitVerb="Import"
            onCancel={handleCancel}
            onImported={handleImported}
          />
        </div>

        {toast ? (
          <p
            role="status"
            className="mt-4 text-center text-[13px] font-medium"
            style={{ color: "#15512c" }}
          >
            {toast}
          </p>
        ) : null}
      </div>
    </div>
  );
}
