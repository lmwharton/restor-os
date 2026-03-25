"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";

/* ── Inline Icons ── */

function WaterDropIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M14 3C14 3 6 12.5 6 17.5C6 22 9.58 25 14 25C18.42 25 22 22 22 17.5C22 12.5 14 3 14 3Z"
        fill="url(#dropGradReadings)"
        stroke="#a63500"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="dropGradReadings" x1="6" y1="3" x2="22" y2="25" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e85d26" stopOpacity="0.15" />
          <stop offset="1" stopColor="#a63500" stopOpacity="0.08" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function JobsIcon({ active = false }: { active?: boolean }) {
  const color = active ? "#e85d26" : "#8d7168";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke={color} strokeWidth="1.5" />
      <path d="M8 5V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" stroke={color} strokeWidth="1.5" />
      <path d="M3 10h18" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function ReadingsIcon({ active = false }: { active?: boolean }) {
  const color = active ? "#e85d26" : "#8d7168";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 20h18" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5 20V10l4-3v13M13 20V8l4-3v15M9 20V7" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TeamIcon({ active = false }: { active?: boolean }) {
  const color = active ? "#e85d26" : "#8d7168";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="7" r="3" stroke={color} strokeWidth="1.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.5" stroke={color} strokeWidth="1.5" />
      <path d="M17 14c2.2 0 4 1.8 4 4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon({ active = false }: { active?: boolean }) {
  const color = active ? "#e85d26" : "#8d7168";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ── Nav ── */

const navItems = [
  { href: "/jobs", label: "Jobs", Icon: JobsIcon },
  { href: "/readings", label: "Readings", Icon: ReadingsIcon },
  { href: "/team", label: "Team", Icon: TeamIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-surface/70 border-b border-outline-variant/30">
      <div className="max-w-7xl mx-auto w-full px-6 h-14 flex items-center justify-between">
        <Link href="/jobs" className="flex items-center gap-2 shrink-0">
          <WaterDropIcon size={24} />
          <span className="text-[17px] font-semibold tracking-[-0.45px] text-on-surface">crewmatic</span>
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href} className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${isActive ? "text-brand-accent bg-brand-accent/8" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-4">
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

function MobileBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 backdrop-blur-xl bg-surface/80 border-t border-outline-variant/30 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16">
        {navItems.map(({ href, label, Icon }) => {
          const isActive = pathname === href || pathname?.startsWith(href + "/");
          return (
            <Link key={href} href={href} className="flex flex-col items-center gap-1 min-w-[48px] min-h-[48px] justify-center">
              <div className="relative">
                <Icon active={isActive} />
                {isActive && <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand-accent" />}
              </div>
              <span className={`text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.06em] ${isActive ? "text-brand-accent" : "text-outline"}`}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ── Page ── */

export default function ReadingsPage() {
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <AppHeader />

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24 md:pb-12 relative">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full opacity-30 blur-[120px] pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(0,98,142,0.08) 0%, transparent 70%)" }}
          aria-hidden="true"
        />

        <div className="relative flex flex-col items-center text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-surface-container flex items-center justify-center mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z" stroke="#a63500" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M8 16a4 4 0 0 0 8 0" stroke="#a63500" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-[-1px] text-on-surface mb-3">
            Moisture readings
          </h1>
          <p className="text-[15px] text-on-surface-variant leading-relaxed mb-8 max-w-sm">
            Track moisture levels, GPP readings, and drying progress across all your active jobs.
          </p>

          <p className="text-[13px] text-outline font-[family-name:var(--font-geist-mono)] uppercase tracking-wider">
            Coming soon
          </p>
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}
