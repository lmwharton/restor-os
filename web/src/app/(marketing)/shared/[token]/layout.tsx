import type { Metadata } from "next";
import type { ReactNode } from "react";

// Token-bearing routes (`/shared/[token]` + `/shared/[token]/moisture`)
// place the bearer token in the URL path. Without this header, any
// outbound `<a href>` / `<img src>` on the page sends the full URL
// (token included) as the Referer to whatever it's pointing at — image
// CDNs, third-party fonts, social-share previews, etc. Blast radius is
// small (tokens are 128-bit, expire fast, and are revocable), but
// suppressing the Referer is one line and there's no use case for
// leaking the path off-site.
//
// Using the Next.js Metadata API (referrer field) instead of a raw
// `<meta>` tag — Next emits it as `<meta name="referrer" content="...">`
// in the document head, and it inherits/overrides cleanly per route
// segment.
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function SharedTokenLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
