import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s — Crewmatic",
    default: "Crewmatic",
  },
};

export default function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // TODO: Check Supabase session, redirect to /login if not authenticated
  // const supabase = createServerClient(...)
  // const { data: { session } } = await supabase.auth.getSession()
  // if (!session) redirect('/login')

  return <>{children}</>;
}
