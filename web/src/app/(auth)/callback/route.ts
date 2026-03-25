import { redirect } from "next/navigation";

/**
 * OAuth callback handler stub.
 *
 * When Supabase Auth is wired up this route will:
 *   1. Exchange the OAuth code for a session via supabase.auth.exchangeCodeForSession()
 *   2. Check if the user's company profile exists (first-time vs returning)
 *   3. Redirect to /onboarding (new) or /jobs (returning)
 *
 * For now it simply redirects to /jobs.
 */
export async function GET() {
  // TODO: const { searchParams } = new URL(request.url);
  // TODO: const code = searchParams.get('code');
  // TODO: exchange code, determine new vs returning user

  redirect("/jobs");
}
