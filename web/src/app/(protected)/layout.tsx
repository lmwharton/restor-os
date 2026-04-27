import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getOnboardingStatusServer } from "@/lib/onboarding-api";
import AppShell from "@/components/app-shell";
import { GoogleMapsProvider } from "@/components/google-maps-provider";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s — Crewmatic",
    default: "Crewmatic",
  },
};

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Use getUser() instead of getSession() — it auto-refreshes expired tokens
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get the refreshed session for the access token
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect("/login");
  }

  // Spec 01I onboarding gate.
  //
  // Read the request pathname (forwarded by proxy.ts as `x-pathname`).
  // Settings recovery surfaces (/settings/jobs/import, /settings/pricing)
  // remain reachable during onboarding so a user who deep-links there can
  // still finish setup. All other protected routes redirect back to
  // /onboarding until `step === 'complete'`.
  const reqHeaders = await headers();
  const pathname = reqHeaders.get("x-pathname") ?? "";
  const isSettings = pathname.startsWith("/settings");

  const status = await getOnboardingStatusServer(session.access_token);

  // Treat backend transient errors permissively — don't strand a known-
  // good user just because the status endpoint flapped. The next request
  // will retry.
  if (status) {
    // No-company case is unconditional: settings recovery surfaces all
    // require a `company_id` and would themselves 4xx. Bounce to the
    // wizard so Step 1 can create the row.
    if (!status.has_company) {
      redirect("/onboarding");
    }
    // Otherwise, incomplete-but-with-company users may pass through the
    // settings recovery surfaces (see qa-checklist E3 / Brett scenario S6).
    if (status.step !== "complete" && !isSettings) {
      redirect("/onboarding");
    }
  }

  return (
    <GoogleMapsProvider>
      <AppShell>{children}</AppShell>
    </GoogleMapsProvider>
  );
}
