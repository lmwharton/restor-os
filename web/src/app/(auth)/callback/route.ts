import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

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
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  let destination = "/onboarding"; // safe default for new users

  try {
    const companyRes = await fetch(`${API_URL}/v1/company`, {
      headers: { Authorization: `Bearer ${session?.access_token}` },
      cache: "no-store",
    });

    if (companyRes.ok) {
      destination = "/jobs";
    }
    // 404 or other non-ok → stay on /onboarding
  } catch {
    // Backend unreachable — fall through to onboarding (safe fallback)
  }

  // Transfer cookies from the Supabase exchange response to our redirect
  const redirectResponse = NextResponse.redirect(`${SITE_URL}${destination}`);
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}
