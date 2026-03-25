"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Clipboard, Gear } from "@/components/icons";
import { HealthStatusBadge } from "@/components/health-status-badge";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Company {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  subscription_tier: string;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: string;
  is_platform_admin: boolean;
  company: Company;
}

/* ------------------------------------------------------------------ */
/*  Navigation data                                                    */
/* ------------------------------------------------------------------ */

const navItems = [
  { href: "/jobs", label: "Jobs", Icon: Clipboard },
  { href: "/settings", label: "Settings", Icon: Gear },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function getAuthHeaders() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token}` };
}

function getUserInitials(user: UserProfile): string {
  if (user.first_name && user.last_name) {
    return (user.first_name[0] + user.last_name[0]).toUpperCase();
  }
  if (user.name && user.name.length >= 2) {
    const parts = user.name.split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return user.name.slice(0, 2).toUpperCase();
  }
  return "??";
}

function getCompanyInitial(company: Company): string {
  return company.name ? company.name[0].toUpperCase() : "C";
}

/* ------------------------------------------------------------------ */
/*  User Avatar + Dropdown                                             */
/* ------------------------------------------------------------------ */

function UserMenu({ user }: { user: UserProfile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const initials = getUserInitials(user);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-full overflow-hidden cursor-pointer flex items-center justify-center ring-2 ring-transparent hover:ring-brand-accent/30 transition-all duration-200 focus:outline-none focus:ring-brand-accent/40"
        aria-label="User menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {user.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <span className="w-8 h-8 rounded-full bg-brand-accent text-on-primary text-[12px] font-bold flex items-center justify-center">
            {initials}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-surface-container-lowest rounded-xl shadow-[0_4px_24px_rgba(31,27,23,0.12),0_1px_4px_rgba(31,27,23,0.06)] border border-outline-variant/20 overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* User info */}
          <div className="px-4 pt-4 pb-3">
            <p className="text-[14px] font-semibold text-on-surface truncate">
              {user.name || "User"}
            </p>
            <p className="text-[12px] text-on-surface-variant truncate mt-0.5">
              {user.email}
            </p>
          </div>

          <div className="h-px bg-outline-variant/20 mx-3" />

          {/* Links */}
          <div className="py-1.5">
            <Link
              href="/settings?tab=profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 20c0-3.31 3.58-6 8-6s8 2.69 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              My Profile
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              <Gear size={16} />
              Settings
            </Link>
          </div>

          <div className="h-px bg-outline-variant/20 mx-3" />

          {/* Sign out */}
          <div className="py-1.5 pb-2">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium text-on-surface-variant hover:text-error hover:bg-error-container/30 transition-colors cursor-pointer text-left"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="16,17 21,12 16,7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Company Logo / Initial                                             */
/* ------------------------------------------------------------------ */

function CompanyBrand({ company }: { company: Company }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0 min-w-0">
      {company.logo_url ? (
        <img
          src={company.logo_url}
          alt={company.name}
          className="w-7 h-7 rounded-lg object-contain bg-surface-container"
        />
      ) : (
        <span className="w-7 h-7 rounded-lg bg-brand-accent/10 text-brand-accent text-[13px] font-bold flex items-center justify-center shrink-0">
          {getCompanyInitial(company)}
        </span>
      )}
      <span className="text-[15px] font-semibold tracking-[-0.3px] text-on-surface truncate hidden sm:block">
        {company.name}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App Header                                                         */
/* ------------------------------------------------------------------ */

function AppHeader({ user }: { user: UserProfile | null }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-surface/70 border-b border-outline-variant/30">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Left: Company brand */}
        {user?.company ? (
          <CompanyBrand company={user.company} />
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-7 h-7 rounded-lg bg-surface-container animate-pulse" />
            <span className="hidden sm:block w-24 h-4 rounded bg-surface-container animate-pulse" />
          </div>
        )}

        {/* Center: Desktop nav */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Main">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  isActive
                    ? "text-brand-accent bg-brand-accent/8"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Status + User */}
        {user ? (
          <div className="flex items-center gap-4">
            <HealthStatusBadge />
            <div className="hidden sm:block h-4 w-px bg-outline-variant/30" />
            <div className="flex items-center gap-2.5">
              <span className="hidden sm:block text-[13px] font-medium text-on-surface-variant">
                {user.name || user.email}
              </span>
              <UserMenu user={user} />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="hidden sm:block w-16 h-4 rounded bg-surface-container animate-pulse" />
            <span className="w-8 h-8 rounded-full bg-surface-container animate-pulse" />
          </div>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile Bottom Nav                                                  */
/* ------------------------------------------------------------------ */

function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 backdrop-blur-xl bg-surface/80 border-t border-outline-variant/30 pb-[env(safe-area-inset-bottom)]"
      aria-label="Mobile navigation"
    >
      <div className="flex items-center justify-around h-16">
        {navItems.map(({ href, label, Icon }) => {
          const isActive =
            pathname === href || pathname?.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-1 min-w-[48px] min-h-[48px] justify-center"
              aria-current={isActive ? "page" : undefined}
            >
              <div className="relative">
                <Icon size={22} className={isActive ? "text-brand-accent" : "text-outline"} />
                {isActive && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand-accent" />
                )}
              </div>
              <span
                className={`text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.06em] ${
                  isActive ? "text-brand-accent" : "text-outline"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  AppShell                                                           */
/* ------------------------------------------------------------------ */

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/v1/me`, {
          headers,
          cache: "no-store",
        });
        if (res.ok && !cancelled) {
          const data: UserProfile = await res.json();
          setUser(data);
        }
      } catch {
        // Backend unreachable — header will show skeleton states
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <AppHeader user={user} />

      <main className="flex-1 pb-20 md:pb-0">{children}</main>

      <AppFooter />
      <MobileBottomNav />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Footer                                                             */
/* ------------------------------------------------------------------ */

function AppFooter() {
  return (
    <footer className="hidden md:block border-t border-outline-variant/15 mt-auto">
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-3 flex items-center justify-between">
        <span className="text-[11px] text-outline font-[family-name:var(--font-geist-mono)]">
          Powered by{" "}
          <a
            href="https://crewmatic-website.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-on-surface-variant hover:text-brand-accent transition-colors"
          >
            Crewmatic
          </a>
        </span>
        <span className="text-[11px] text-outline font-[family-name:var(--font-geist-mono)]">
          v{APP_VERSION}
        </span>
      </div>
    </footer>
  );
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";

export { getAuthHeaders, API_URL };
export type { Company };
