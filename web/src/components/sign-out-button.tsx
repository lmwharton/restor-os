"use client";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ className }: { className?: string }) {
  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Full page reload ensures server-side auth state is cleared
    window.location.href = "/login";
  }

  return (
    <button
      onClick={handleSignOut}
      className={
        className ??
        "text-[13px] font-medium text-[#8d7168] hover:text-[#1f1b17] transition-colors cursor-pointer"
      }
    >
      Sign Out
    </button>
  );
}
