import type { Metadata } from "next";

// signup/page.tsx is "use client" so it can't export metadata itself.
// This layout-level override gives the route the right tab title.
export const metadata: Metadata = {
  title: "Create Account",
  description: "Sign up for Crewmatic — the Operating System for Restoration Contractors.",
};

export default function SignupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
