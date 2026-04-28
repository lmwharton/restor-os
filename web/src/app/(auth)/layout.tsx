import type { Metadata } from "next";

// Layout-level fallback. Each page (login, signup) overrides with a more
// specific title/description in its own `metadata` export.
export const metadata: Metadata = {
  title: {
    template: "%s — Crewmatic",
    default: "Sign In — Crewmatic",
  },
  description: "Sign in to Crewmatic, the Operating System for Restoration Contractors.",
};

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
