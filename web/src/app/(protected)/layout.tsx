import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
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
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  return <AppShell>{children}</AppShell>;
}
