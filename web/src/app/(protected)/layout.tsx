import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedRedirect } from "@/lib/auth-redirect";
import AppShell from "@/components/app-shell";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Check if user has completed onboarding (has a company).
  // IMPORTANT: /onboarding must NOT be inside (protected) to avoid infinite redirect loops.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    const destination = await getAuthenticatedRedirect(session.access_token);
    if (destination !== "/dashboard") {
      redirect(destination);
    }
  }

  return <AppShell>{children}</AppShell>;
}
