"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Dashboard, Clipboard, Gear } from "@/components/icons";
import { HealthStatusBadge } from "@/components/health-status-badge";
import NotificationDropdown from "@/components/notification-dropdown";
import { useJobs } from "@/lib/hooks/use-jobs";
import { useMe } from "@/lib/hooks/use-me";

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
  { href: "/dashboard", label: "Dashboard", Icon: Dashboard },
  { href: "/jobs", label: "Jobs", Icon: Clipboard },
  { href: "/settings", label: "Settings", Icon: Gear },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MONO = "font-[family-name:var(--font-geist-mono)]";

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
/*  User Avatar (compact, for top bar)                                 */
/* ------------------------------------------------------------------ */

function UserAvatarButton({ user }: { user: UserProfile }) {
  const initials = getUserInitials(user);
  const [imgError, setImgError] = useState(false);

  return user.avatar_url && !imgError ? (
    <img
      src={user.avatar_url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setImgError(true)}
      className="w-8 h-8 rounded-full object-cover"
    />
  ) : (
    <span className="w-8 h-8 rounded-full bg-brand-accent text-on-primary text-[12px] font-bold flex items-center justify-center">
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  User Menu Dropdown (used in top bar on desktop)                    */
/* ------------------------------------------------------------------ */

function UserMenu({ user }: { user: UserProfile }) {
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  }
  function handleLeave() {
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const initials = getUserInitials(user);

  return (
    <div ref={ref} className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        className="w-8 h-8 rounded-full overflow-hidden cursor-pointer flex items-center justify-center ring-2 ring-transparent hover:ring-brand-accent/30 transition-all duration-200 focus:outline-none focus:ring-brand-accent/40"
        aria-label="User menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {user.avatar_url && !imgError ? (
          <img
            src={user.avatar_url}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-8 h-8 rounded-full object-cover"
          />
        ) : (
          <span className="w-8 h-8 rounded-full bg-brand-accent text-on-primary text-[12px] font-bold flex items-center justify-center">
            {initials}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 bg-surface-container-lowest rounded-lg shadow-[0_4px_24px_rgba(31,27,23,0.12),0_1px_4px_rgba(31,27,23,0.06)] border border-outline-variant/20 overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-3 pt-3 pb-2">
            <p className="text-[13px] font-semibold text-on-surface truncate">
              {user.name || "User"}
            </p>
            <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
              {user.email}
            </p>
          </div>

          <div className="h-px bg-outline-variant/20 mx-2.5" />

          <div className="py-1">
            <Link
              href="/settings?tab=profile"
              className="flex items-center gap-2.5 px-3 py-2 text-[12px] font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 20c0-3.31 3.58-6 8-6s8 2.69 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              My Profile
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-2.5 px-3 py-2 text-[12px] font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              <Gear size={14} />
              Settings
            </Link>
          </div>

          <div className="h-px bg-outline-variant/20 mx-2.5" />

          <div className="py-1 pb-1.5">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-medium text-red-600 hover:bg-red-50 transition-colors cursor-pointer text-left"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
      <span className="text-[15px] font-semibold tracking-[-0.3px] text-on-surface truncate">
        {company.name}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop Left Sidebar                                               */
/* ------------------------------------------------------------------ */

function DesktopSidebar({ user }: { user: UserProfile | null }) {
  const pathname = usePathname();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-56 z-40 flex-col bg-surface-container-lowest border-r border-outline-variant/20">
      {/* Top: Company brand */}
      <div className="h-14 flex items-center px-4 border-b border-outline-variant/15 shrink-0">
        {user?.company ? (
          <CompanyBrand company={user.company} />
        ) : (
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-surface-container animate-pulse" />
            <span className="w-20 h-4 rounded bg-surface-container animate-pulse" />
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 px-2 space-y-0.5" aria-label="Main navigation">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                isActive
                  ? "text-brand-accent bg-brand-accent/8"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <item.Icon size={20} className={isActive ? "text-brand-accent" : "text-outline"} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="mt-auto border-t border-outline-variant/15 px-3 py-3">
        <p className="text-[10px] text-outline font-[family-name:var(--font-geist-mono)]">
          Powered by{" "}
          <a href="https://crewmatic-website.vercel.app" target="_blank" rel="noopener noreferrer" className="text-on-surface-variant hover:text-brand-accent transition-colors">Crewmatic</a>
        </p>
        <p className="text-[10px] text-outline/50 font-[family-name:var(--font-geist-mono)] mt-0.5">v{APP_VERSION}</p>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop Top Bar (simplified — sidebar handles nav)                 */
/* ------------------------------------------------------------------ */

function GlobalSearch() {
  const router = useRouter();
  const { data: jobs } = useJobs();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim() || !jobs) return [];
    const q = query.toLowerCase();
    return jobs.filter((j) =>
      j.address_line1.toLowerCase().includes(q) ||
      (j.customer_name && j.customer_name.toLowerCase().includes(q)) ||
      (j.job_number && j.job_number.toLowerCase().includes(q)) ||
      (j.city && j.city.toLowerCase().includes(q))
    ).slice(0, 6);
  }, [query, jobs]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function navigate(jobId: string) {
    setOpen(false);
    setQuery("");
    router.push(`/jobs/${jobId}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") {
      if (activeIdx >= 0 && results[activeIdx]) { navigate(results[activeIdx].id); }
      else if (query.trim()) { setOpen(false); setQuery(""); router.push(`/jobs?search=${encodeURIComponent(query.trim())}`); }
    }
  }

  return (
    <div ref={wrapperRef} className="relative flex-1 max-w-md">
      <svg
        width="16" height="16" viewBox="0 0 24 24" fill="none"
        className="absolute left-3 top-1/2 -translate-y-1/2 text-outline z-10"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(-1); }}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search jobs, addresses..."
        className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface-container/60 text-[13px] text-on-surface placeholder:text-outline border-none outline-none focus:bg-surface-container focus:ring-1 focus:ring-brand-accent/30 transition-colors"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/30 overflow-hidden z-50">
          {results.map((job, i) => (
            <button
              key={job.id}
              type="button"
              onMouseDown={() => navigate(job.id)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3.5 py-2.5 flex items-center gap-3 transition-colors cursor-pointer ${
                i === activeIdx ? "bg-surface-container" : "hover:bg-surface-container/50"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-brand-accent shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-on-surface truncate">
                  {job.address_line1}
                </p>
                <p className="text-[11px] text-outline truncate">
                  {[job.city, job.state].filter(Boolean).join(", ")}
                  {job.customer_name ? ` · ${job.customer_name}` : ""}
                </p>
              </div>
              <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-outline shrink-0">
                {job.job_number}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DesktopTopBar({ user }: { user: UserProfile | null }) {
  const pathname = usePathname();
  const hideTopBar = pathname === "/jobs" || pathname?.startsWith("/jobs/") || pathname === "/settings" || pathname?.startsWith("/settings/");

  if (hideTopBar) return null;

  return (
    <header className="hidden lg:block sticky top-0 z-30 backdrop-blur-xl bg-surface/70 border-b border-outline-variant/30 lg:ml-56">
      <div className="w-full px-6 h-12 flex items-center justify-between">
        {/* Left: Search — hidden on /jobs which has its own */}
        <GlobalSearch />

        {/* Right: Status + Notification + Avatar */}
        <div className="flex items-center gap-3">
          <HealthStatusBadge />
          <NotificationDropdown />
          {user && <UserMenu user={user} />}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile Header (full nav, shown below lg:)                          */
/* ------------------------------------------------------------------ */

function MobileHeader({ user }: { user: UserProfile | null }) {
  const pathname = usePathname();

  return (
    <header className="lg:hidden sticky top-0 z-50 backdrop-blur-xl bg-surface/70 border-b border-outline-variant/30">
      <div className="w-full px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Left: Company brand */}
        {user?.company ? (
          <CompanyBrand company={user.company} />
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-7 h-7 rounded-lg bg-surface-container animate-pulse" />
            <span className="hidden sm:block w-24 h-4 rounded bg-surface-container animate-pulse" />
          </div>
        )}

        {/* Center: Desktop nav (md to lg) */}
        <nav className="hidden md:flex lg:hidden items-center gap-1" aria-label="Main">
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

        {/* Right: Status + Notifications + User */}
        {user ? (
          <div className="flex items-center gap-3">
            <HealthStatusBadge />
            <NotificationDropdown />
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
      <div className="flex items-center justify-around h-12">
        {navItems.map(({ href, label, Icon }) => {
          const isActive =
            pathname === href || pathname?.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-0.5 min-w-[44px] min-h-[40px] justify-center"
              aria-current={isActive ? "page" : undefined}
            >
              <div className="relative">
                <Icon size={18} className={isActive ? "text-brand-accent" : "text-outline"} />
                {isActive && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand-accent" />
                )}
              </div>
              <span
                className={`text-[8px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.06em] ${
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
  const { data: user = null } = useMe() as { data: UserProfile | null | undefined };
  const pathname = usePathname();
  // Full-bleed routes: hide mobile header + bottom nav so the content owns
  // the full viewport. Desktop top bar is already hidden for /jobs/* routes.
  //
  // Job detail + sub-routes (/jobs/<id>, /jobs/<id>/photos, etc.) are focused
  // task views — the sub-header's back arrow is the only nav the user needs.
  // /jobs (list) and /jobs/new (form) keep the full chrome.
  const isFloorPlan = pathname?.includes("/floor-plan");
  const isJobDetail =
    !!pathname?.startsWith("/jobs/") && !pathname.startsWith("/jobs/new");
  const hideMobileNav = isFloorPlan || isJobDetail;
  const hideMobileHeader = isFloorPlan || isJobDetail;

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Desktop: sidebar + thin top bar */}
      <DesktopSidebar user={user} />
      <DesktopTopBar user={user} />

      {/* Mobile/Tablet: full header (hidden on floor-plan for more canvas) */}
      {!hideMobileHeader && <MobileHeader user={user} />}

      {/* Main content — offset for sidebar on lg: */}
      <main className={`flex-1 lg:ml-56 ${hideMobileNav ? "" : "pb-20 md:pb-0"}`}>{children}</main>

      {!hideMobileNav && <MobileBottomNav />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Footer                                                             */
/* ------------------------------------------------------------------ */

function AppFooter() {
  return (
    <footer className="hidden md:block border-t border-outline-variant/15 mt-auto">
      <div className="w-full px-4 sm:px-6 py-3 flex items-center justify-between">
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
