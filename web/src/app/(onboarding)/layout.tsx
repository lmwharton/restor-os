import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
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

  return <>{children}</>;
}
