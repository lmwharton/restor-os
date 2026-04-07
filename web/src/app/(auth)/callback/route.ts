import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getAuthenticatedRedirect } from "@/lib/auth-redirect";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${SITE_URL}/login`);
  }

  const response = NextResponse.redirect(`${SITE_URL}/jobs`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback error:", error.message);
    const errorResponse = NextResponse.redirect(`${SITE_URL}/login`);
    // Clear any partially-set auth cookies to prevent half-authenticated state
    request.cookies.getAll().forEach((cookie) => {
      if (cookie.name.startsWith("sb-")) {
        errorResponse.cookies.set(cookie.name, "", { maxAge: 0 });
      }
    });
    return errorResponse;
  }

  // Check if user already has a company — determines onboarding vs jobs redirect
  const { data: { session } } = await supabase.auth.getSession();
  const destination = session?.access_token
    ? await getAuthenticatedRedirect(session.access_token)
    : "/onboarding";

  // Transfer cookies from the Supabase exchange response to our redirect
  const redirectResponse = NextResponse.redirect(`${SITE_URL}${destination}`);
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}
