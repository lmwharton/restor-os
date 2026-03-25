"use client";

import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";
import { Clipboard, Waves, People, Gear } from "@/components/icons";

type NavTab = "jobs" | "readings" | "team" | "settings";

interface AppShellProps {
  children: React.ReactNode;
  companyName: string;
  activeTab: NavTab;
}

const NAV_ITEMS: { tab: NavTab; label: string; href: string; icon: typeof Clipboard }[] = [
  { tab: "jobs", label: "Jobs", href: "/jobs", icon: Clipboard },
  { tab: "readings", label: "Readings", href: "/readings", icon: Waves },
  { tab: "team", label: "Team", href: "/team", icon: People },
  { tab: "settings", label: "Settings", href: "/settings", icon: Gear },
];

function signOut() {
  // Placeholder — will be wired to Supabase auth
  console.log("Sign out");
}

export function AppShell({ children, companyName, activeTab }: AppShellProps) {
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Desktop header */}
      <header className="sticky top-0 z-40 border-b border-outline-variant bg-surface/80 backdrop-blur-md">
        <div className="max-w-[1024px] mx-auto px-6 h-[60px] flex items-center justify-between">
          {/* Left: brand */}
          <BrandWordmark />

          {/* Center: desktop nav */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Main">
            {NAV_ITEMS.map(({ tab, label, href }) => (
              <Link
                key={tab}
                href={href}
                className={`px-4 py-2 rounded-lg text-[14px] font-medium transition-colors min-h-[48px] flex items-center ${
                  activeTab === tab
                    ? "text-brand-accent"
                    : "text-on-surface hover:text-brand-accent/80 hover:bg-surface-container"
                }`}
                aria-current={activeTab === tab ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* Right: company + sign out */}
          <div className="flex items-center gap-3">
            <span className="hidden sm:block font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-on-surface-variant">
              {companyName}
            </span>
            <button
              onClick={signOut}
              className="text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors px-3 py-2 rounded-lg hover:bg-surface-container min-h-[48px]"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 pb-20 md:pb-0">{children}</main>

      {/* Mobile bottom navigation */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-outline-variant bg-surface/80 backdrop-blur-md"
        aria-label="Mobile navigation"
      >
        <div className="flex items-center justify-around h-[64px] px-2">
          {NAV_ITEMS.map(({ tab, label, href, icon: Icon }) => {
            const isActive = activeTab === tab;
            return (
              <Link
                key={tab}
                href={href}
                className={`flex flex-col items-center justify-center gap-0.5 min-w-[64px] min-h-[48px] rounded-lg transition-colors ${
                  isActive
                    ? "text-brand-accent"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={22} />
                <span className="text-[11px] font-medium">{label}</span>
                {isActive && (
                  <span className="w-1 h-1 rounded-full bg-brand-accent mt-0.5" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
