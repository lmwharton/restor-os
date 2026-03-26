import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/app-shell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s — Crewmatic",
    default: "Crewmatic",
  },
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
    try {
      const res = await fetch(`${API_URL}/v1/company`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      if (res.status === 404) {
        redirect("/onboarding");
      }
    } catch {
      // Backend unreachable — let it through, AppShell will show skeleton
    }
  }

  return <AppShell>{children}</AppShell>;
}
