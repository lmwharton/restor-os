import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { GoogleMapsProvider } from "@/components/google-maps-provider";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Get Started — Crewmatic",
};

export default async function OnboardingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  // Onboarding's CompanyProfileScreen uses Google Places autocomplete on
  // the business address field. Without this provider the input still
  // works as a plain text field (graceful degradation).
  return <GoogleMapsProvider>{children}</GoogleMapsProvider>;
}
