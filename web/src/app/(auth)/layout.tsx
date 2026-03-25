import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In — Crewmatic",
  description: "Sign in to Crewmatic, the Operating System for Restoration Contractors.",
};

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
