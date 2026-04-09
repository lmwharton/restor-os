import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedRedirect } from "@/lib/auth-redirect";
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

  // Check if user has completed onboarding (has a company).
  // IMPORTANT: /onboarding must NOT be inside (protected) to avoid infinite redirect loops.
  const destination = await getAuthenticatedRedirect(session.access_token);
  if (destination !== "/dashboard") {
    redirect(destination);
  }

  return (
    <GoogleMapsProvider>
      <AppShell>{children}</AppShell>
    </GoogleMapsProvider>
  );
}
