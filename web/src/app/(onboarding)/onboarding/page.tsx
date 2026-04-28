/**
 * /onboarding — server component entry to the onboarding wizard.
 *
 * Reads `GET /v1/company/onboarding-status` server-side and:
 *   - if no auth user → /login
 *   - if status returns step === 'complete' → /dashboard (already done)
 *   - otherwise → render the wizard at the right step
 *
 * Routing on resume happens here, NOT in client land — avoids a flicker
 * where the wrong screen renders before the status response lands.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getOnboardingStatusServer,
  type OnboardingStatus,
} from "@/lib/onboarding-api";
import OnboardingWizard from "./wizard";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    redirect("/login");
  }

  const status = await getOnboardingStatusServer(session.access_token);

  // If the backend is unreachable, render the wizard at Step 1 with a
  // permissive default. The client will re-fetch on its own user actions.
  // This keeps the page from hard-erroring in the rare backend-flap case.
  const safeStatus: OnboardingStatus =
    status ??
    {
      step: "company_profile",
      completed_at: null,
      setup_banner_dismissed_at: null,
      has_jobs: false,
      has_pricing: false,
      has_company: false,
      show_setup_banner: false,
    };

  // Already completed → bounce to the dashboard so the wizard isn't
  // accessible by URL once setup is done.
  if (safeStatus.step === "complete" && safeStatus.has_company) {
    redirect("/dashboard");
  }

  return <OnboardingWizard initialStatus={safeStatus} />;
}
