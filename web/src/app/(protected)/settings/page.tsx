"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/sign-out-button";

/* ------------------------------------------------------------------ */
/*  Inline SVG Icons                                                   */
/* ------------------------------------------------------------------ */

function WaterDropIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M14 3C14 3 6 12.5 6 17.5C6 22 9.58 25 14 25C18.42 25 22 22 22 17.5C22 12.5 14 3 14 3Z"
        fill="url(#dropGradSettings)"
        stroke="#a63500"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="dropGradSettings" x1="6" y1="3" x2="22" y2="25" gradientUnits="userSpaceOnUse">
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

function SettingsIcon({ active = false }: { active?: boolean }) {
  const color = active ? "#e85d26" : "#8d7168";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" />
      <path
        d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="20" height="14" rx="2" stroke="#8d7168" strokeWidth="1.5" />
      <circle cx="12" cy="13" r="3.5" stroke="#8d7168" strokeWidth="1.5" />
      <path d="M8 6l1-3h6l1 3" stroke="#8d7168" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Navigation                                                         */
/* ------------------------------------------------------------------ */

const navItems = [
  { href: "/jobs", label: "Jobs", Icon: JobsIcon },
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
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  isActive ? "text-brand-accent bg-brand-accent/8" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
              >
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
              <span className={`text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.06em] ${isActive ? "text-brand-accent" : "text-outline"}`}>
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
/*  Shared UI                                                          */
/* ------------------------------------------------------------------ */

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-[11px] font-semibold tracking-[0.1em] uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]">
      {children}
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="h-12 px-4 rounded-lg bg-surface-container-high flex items-center text-[15px] text-on-surface-variant">{value || "\u00A0"}</div>
    </div>
  );
}

function StatusMessage({ message }: { message: string }) {
  if (!message) return null;
  const isSuccess = message === "Saved" || message.includes("uploaded") || message.includes("updated");
  return <p className={`text-sm mt-3 ${isSuccess ? "text-green-600" : "text-red-500"}`}>{message}</p>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function getAuthHeaders() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token}` };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/* ------------------------------------------------------------------ */
/*  Settings Tabs                                                      */
/* ------------------------------------------------------------------ */

const tabs = [
  { id: "organization", label: "Organization" },
  { id: "profile", label: "My Profile" },
  { id: "team", label: "Team" },
] as const;

type TabId = (typeof tabs)[number]["id"];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("organization");

  // Company state
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [orgMessage, setOrgMessage] = useState("");

  // Profile state
  const [userName, setUserName] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState("owner");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");

  // Loading
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/v1/me`, { headers, cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setCompanyName(data.company?.name || "");
          setPhone(data.company?.phone || "");
          setLogoUrl(data.company?.logo_url || "");
          setUserName(data.name || "");
          setUserPhone(data.phone || "");
          setUserEmail(data.email || "");
          setUserRole(data.role || "owner");
        }
      } catch {
        // Backend unreachable
      } finally {
        setIsLoading(false);
      }
    }
    loadProfile();
  }, []);

  async function handleSaveOrg() {
    setIsSaving(true);
    setOrgMessage("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/v1/company`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: companyName.trim() || undefined, phone: phone.trim() || undefined }),
      });
      if (res.ok) {
        setOrgMessage("Saved");
        setTimeout(() => setOrgMessage(""), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setOrgMessage(data.error || "Failed to save");
      }
    } catch {
      setOrgMessage("Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setOrgMessage("Logo must be under 2MB");
      return;
    }
    setIsUploading(true);
    setOrgMessage("");
    try {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/v1/company/logo`, { method: "POST", headers, body: formData });
      if (res.ok) {
        const data = await res.json();
        setLogoUrl(data.logo_url);
        setOrgMessage("Logo uploaded");
        setTimeout(() => setOrgMessage(""), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setOrgMessage(data.error || "Failed to upload");
      }
    } catch {
      setOrgMessage("Failed to upload");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSaveProfile() {
    setIsSavingProfile(true);
    setProfileMessage("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/v1/me`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: userName.trim() || undefined, phone: userPhone.trim() || undefined }),
      });
      if (res.ok) {
        setProfileMessage("Profile updated");
        setTimeout(() => setProfileMessage(""), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setProfileMessage(data.error || "Failed to save");
      }
    } catch {
      setProfileMessage("Failed to save");
    } finally {
      setIsSavingProfile(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <AppHeader />

      <main className="flex-1 px-6 pb-24 md:pb-12">
        <div className="max-w-[600px] mx-auto pt-8 sm:pt-12">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-[-0.5px] text-on-surface mb-6">Settings</h1>

          {/* Tabs */}
          <div className="flex gap-1 mb-8 bg-surface-container rounded-lg p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-2.5 px-4 rounded-md text-[13px] font-medium transition-all cursor-pointer ${
                  activeTab === tab.id
                    ? "bg-surface-container-lowest text-on-surface shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Organization Tab */}
          {activeTab === "organization" && (
            <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04),0_8px_32px_rgba(31,27,23,0.08)] p-6 sm:p-8">
              <div className="space-y-5">
                <div>
                  <FieldLabel htmlFor="settings-company">Company Name</FieldLabel>
                  <input
                    id="settings-company"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder={isLoading ? "Loading..." : ""}
                    className="w-full h-12 px-4 rounded-lg bg-surface-container-low text-on-surface text-[15px] placeholder:text-outline transition-all duration-200 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest"
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="settings-phone">Phone Number</FieldLabel>
                  <input
                    id="settings-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-full h-12 px-4 rounded-lg bg-surface-container-low text-on-surface text-[15px] placeholder:text-outline transition-all duration-200 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest"
                  />
                </div>

                <div>
                  <FieldLabel>Company Logo</FieldLabel>
                  <label className="block h-28 rounded-lg bg-surface-container flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-surface-container-high transition-colors overflow-hidden relative">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Company logo" className="h-full w-full object-contain p-2" />
                    ) : (
                      <>
                        <CameraIcon />
                        <span className="text-[13px] text-outline">{isUploading ? "Uploading..." : "Click to upload logo"}</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      onChange={handleLogoUpload}
                      disabled={isUploading}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                  </label>
                </div>

                <StatusMessage message={orgMessage} />

                <button
                  onClick={handleSaveOrg}
                  disabled={isSaving}
                  className="h-12 px-6 rounded-xl text-[14px] font-semibold text-on-primary primary-gradient cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSaving ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "Save Changes"}
                </button>
              </div>
            </section>
          )}

          {/* Profile Tab */}
          {activeTab === "profile" && (
            <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04),0_8px_32px_rgba(31,27,23,0.08)] p-6 sm:p-8">
              <div className="space-y-5">
                <div>
                  <FieldLabel htmlFor="settings-name">Name</FieldLabel>
                  <input
                    id="settings-name"
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder={isLoading ? "Loading..." : ""}
                    className="w-full h-12 px-4 rounded-lg bg-surface-container-low text-on-surface text-[15px] placeholder:text-outline transition-all duration-200 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest"
                  />
                </div>

                <ReadOnlyField label="Email" value={isLoading ? "Loading..." : userEmail} />

                <div>
                  <FieldLabel htmlFor="settings-user-phone">Phone</FieldLabel>
                  <input
                    id="settings-user-phone"
                    type="tel"
                    value={userPhone}
                    onChange={(e) => setUserPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-full h-12 px-4 rounded-lg bg-surface-container-low text-on-surface text-[15px] placeholder:text-outline transition-all duration-200 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest"
                  />
                </div>

                <div>
                  <FieldLabel>Role</FieldLabel>
                  <div className="inline-flex items-center h-8 px-3 rounded-full bg-brand-accent/10 text-brand-accent text-[12px] font-semibold font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.06em]">
                    {userRole}
                  </div>
                </div>

                <StatusMessage message={profileMessage} />

                <button
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile}
                  className="h-12 px-6 rounded-xl text-[14px] font-semibold text-on-primary primary-gradient cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSavingProfile ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "Save Profile"}
                </button>

                {/* Sign Out */}
                <div className="pt-4 border-t border-outline-variant/30">
                  <SignOutButton className="h-12 px-6 rounded-xl text-[14px] font-semibold text-on-surface bg-surface-container-high hover:bg-surface-dim cursor-pointer transition-colors active:scale-[0.98]" />
                </div>
              </div>
            </section>
          )}

          {/* Team Tab */}
          {activeTab === "team" && (
            <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04),0_8px_32px_rgba(31,27,23,0.08)] p-6 sm:p-8">
              <div className="flex flex-col items-center text-center py-8">
                <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="9" cy="7" r="3" stroke="#8d7168" strokeWidth="1.5" />
                    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#8d7168" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="17" cy="9" r="2.5" stroke="#8d7168" strokeWidth="1.5" />
                    <path d="M17 14c2.2 0 4 1.8 4 4" stroke="#8d7168" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-on-surface mb-2">Team Management</h3>
                <p className="text-sm text-on-surface-variant max-w-xs">
                  Invite technicians and manage your crew. Coming soon with team invitations and role management.
                </p>
              </div>
            </section>
          )}
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
}
