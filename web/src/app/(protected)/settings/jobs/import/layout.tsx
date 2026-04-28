import type { Metadata } from "next";

// Settings/jobs/import/page.tsx is "use client" so it can't export
// metadata directly. This layout-level override fills in the route's
// tab title via the protected layout's `%s — Crewmatic` template.
export const metadata: Metadata = {
  title: "Import Jobs",
};

export default function ImportJobsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
