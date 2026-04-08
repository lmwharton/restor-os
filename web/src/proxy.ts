import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Public routes that don't need any auth check
const PUBLIC_PATHS = ["/", "/login", "/signup", "/auth", "/callback", "/onboarding", "/shared", "/competitive", "/research", "/product", "/privacy", "/terms", "/support"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth entirely for public pages
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request });
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

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
