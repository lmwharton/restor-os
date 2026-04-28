import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Public routes that don't need any auth check
const PUBLIC_PATHS = ["/", "/login", "/signup", "/auth", "/callback", "/onboarding", "/shared", "/competitive", "/research", "/product", "/privacy", "/terms", "/support"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Forward the current pathname to server components via a request header.
  // Spec 01I's onboarding gate in (protected)/layout.tsx needs to whitelist
  // /settings/* without doing client-side checks. Next.js 16 server-component
  // layouts can't read `nextUrl` directly, but they can read forwarded headers.
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.set("x-pathname", pathname);

  // Skip auth entirely for public pages
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next({ request: { headers: forwardHeaders } });
  }

  let response = NextResponse.next({ request: { headers: forwardHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          // Preserve forwardHeaders on the rebuild so x-pathname survives
          // a token-refresh write. Without this, the layout's path-aware
          // gate sees an empty pathname and incorrectly bounces users
          // away from /settings/* during onboarding.
          response = NextResponse.next({ request: { headers: forwardHeaders } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: forwardHeaders } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  // getUser() validates the token server-side AND refreshes expired tokens,
  // persisting new cookies via the set/remove handlers above.
  // getSession() only reads the local JWT without refreshing.
  const { data: { user } } = await supabase.auth.getUser();

  // If no user on a protected route, redirect to login
  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Re-tag the pathname header on the final response so later middlewares
  // / RSCs see the same value the auth check used.
  response.headers.set("x-pathname", pathname);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
