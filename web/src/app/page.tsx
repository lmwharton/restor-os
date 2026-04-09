import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedRedirect } from "@/lib/auth-redirect";

export default async function Home() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      redirect("/login");
    }

    const { data: { session } } = await supabase.auth.getSession();
    const destination = session?.access_token
      ? await getAuthenticatedRedirect(session.access_token)
      : "/onboarding";
    redirect(destination);
  } catch (error) {
    // Re-throw Next.js redirect errors (they use throw internally)
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    // Supabase not configured — send to login page
    redirect("/login");
  }
}
