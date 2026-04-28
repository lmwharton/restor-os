import type { Metadata } from "next";

// Settings/pricing/page.tsx is "use client" so it can't export metadata
// directly. This layout-level override fills in the route's tab title
// via the protected layout's `%s — Crewmatic` template.
export const metadata: Metadata = {
  title: "Pricing",
};

export default function PricingSettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
