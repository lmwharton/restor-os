"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AddressAutocomplete } from "@/components/address-autocomplete";

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

/* ------------------------------------------------------------------ */
/*  Inline Icons                                                       */
/* ------------------------------------------------------------------ */

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
/*  Shared UI                                                          */
/* ------------------------------------------------------------------ */

function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[11px] font-semibold tracking-[0.1em] uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]"
    >
      {children}
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="h-12 px-4 rounded-lg bg-surface-container-high flex items-center text-[15px] text-on-surface-variant">
        {value || "\u00A0"}
      </div>
    </div>
  );
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full h-12 px-4 rounded-lg bg-surface-container-low text-on-surface text-[15px] placeholder:text-outline transition-all duration-200 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest disabled:opacity-50 disabled:cursor-not-allowed"
    />
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <div className="inline-flex items-center h-8 px-3 rounded-full bg-brand-accent/10 text-brand-accent text-[12px] font-semibold font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.06em]">
      {role}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    free: "bg-outline/10 text-outline",
    starter: "bg-tertiary/10 text-tertiary",
    pro: "bg-brand-accent/10 text-brand-accent",
    enterprise: "bg-primary/10 text-primary",
  };
  const cls = colors[tier] || colors.free;
  return (
    <div
      className={`inline-flex items-center h-8 px-3 rounded-full text-[12px] font-semibold font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.06em] ${cls}`}
    >
      {tier}
    </div>
  );
}

function StatusMessage({ message }: { message: string }) {
  if (!message) return null;
  const isSuccess =
    message === "Saved" ||
    message.includes("uploaded") ||
    message.includes("updated");
  return (
    <p className={`text-sm mt-3 ${isSuccess ? "text-green-600" : "text-red-500"}`}>
      {message}
    </p>
  );
}

function SaveButton({
  onClick,
  isSaving,
  disabled = false,
  label = "Save Changes",
}: {
  onClick: () => void;
  isSaving: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isSaving || disabled}
      className="h-12 px-6 rounded-xl text-[14px] font-semibold text-on-primary bg-brand-accent cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {isSaving ? (
        <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        label
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
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
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: TabId =
    tabParam === "profile" || tabParam === "team" || tabParam === "organization"
      ? tabParam
      : "organization";

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  // Sync tab with URL param changes
  useEffect(() => {
    if (
      tabParam === "profile" ||
      tabParam === "team" ||
      tabParam === "organization"
    ) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  // Company state
  const [companyName, setCompanyName] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyCity, setCompanyCity] = useState("");
  const [companyState, setCompanyState] = useState("");
  const [companyZip, setCompanyZip] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [subscriptionTier, setSubscriptionTier] = useState("free");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [orgMessage, setOrgMessage] = useState("");

  // Profile state
  const [userName, setUserName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userTitle, setUserTitle] = useState("");
  const [userRole, setUserRole] = useState("owner");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");

  // Loading
  const [isLoading, setIsLoading] = useState(true);

  // Track original values for dirty detection
  const orgOriginal = useRef({ name: "", phone: "", email: "", address: "", city: "", state: "", zip: "" });
  const profileOriginal = useRef({ name: "", firstName: "", lastName: "", phone: "", title: "" });

  const orgDirty =
    companyName !== orgOriginal.current.name ||
    companyPhone !== orgOriginal.current.phone ||
    companyEmail !== orgOriginal.current.email ||
    companyAddress !== orgOriginal.current.address ||
    companyCity !== orgOriginal.current.city ||
    companyState !== orgOriginal.current.state ||
    companyZip !== orgOriginal.current.zip;

  const profileDirty =
    userName !== profileOriginal.current.name ||
    firstName !== profileOriginal.current.firstName ||
    lastName !== profileOriginal.current.lastName ||
    userPhone !== profileOriginal.current.phone ||
    userTitle !== profileOriginal.current.title;

  useEffect(() => {
    async function loadProfile() {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_URL}/v1/me`, {
          headers,
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          // Company
          const cn = data.company?.name || "";
          const cp = data.company?.phone || "";
          const ce = data.company?.email || "";
          const ca = data.company?.address || "";
          const cc = data.company?.city || "";
          const cs = data.company?.state || "";
          const cz = data.company?.zip || "";
          setCompanyName(cn); setCompanyPhone(cp); setCompanyEmail(ce);
          setCompanyAddress(ca); setCompanyCity(cc); setCompanyState(cs); setCompanyZip(cz);
          setLogoUrl(data.company?.logo_url || "");
          setSubscriptionTier(data.company?.subscription_tier || "free");
          orgOriginal.current = { name: cn, phone: cp, email: ce, address: ca, city: cc, state: cs, zip: cz };
          // Profile
          const un = data.name || "";
          const fn = data.first_name || "";
          const ln = data.last_name || "";
          const up = data.phone || "";
          const ut = data.title || "";
          setUserName(un); setFirstName(fn); setLastName(ln);
          setUserPhone(up); setUserTitle(ut);
          setUserEmail(data.email || "");
          setUserRole(data.role || "owner");
          setAvatarUrl(data.avatar_url || "");
          profileOriginal.current = { name: un, firstName: fn, lastName: ln, phone: up, title: ut };
        }
      } catch {
        // Backend unreachable
      } finally {
        setIsLoading(false);
      }
    }
    loadProfile();
  }, []);

  /* ------ Organization handlers ------ */

  async function handleSaveOrg() {
    setIsSaving(true);
    setOrgMessage("");
    try {
      const headers = await getAuthHeaders();
      const body: Record<string, string | undefined> = {
        name: companyName.trim() || undefined,
        phone: companyPhone.trim() || undefined,
        email: companyEmail.trim() || undefined,
        address: companyAddress.trim() || undefined,
        city: companyCity.trim() || undefined,
        state: companyState.trim() || undefined,
        zip: companyZip.trim() || undefined,
      };
      const res = await fetch(`${API_URL}/v1/company`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        orgOriginal.current = { name: companyName.trim(), phone: companyPhone.trim(), email: companyEmail.trim(), address: companyAddress.trim(), city: companyCity.trim(), state: companyState.trim(), zip: companyZip.trim() };
        setOrgMessage("Saved");
        setTimeout(() => setOrgMessage(""), 3000);
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
      const res = await fetch(`${API_URL}/v1/company/logo`, {
        method: "POST",
        headers,
        body: formData,
      });
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

  /* ------ Profile handlers ------ */

  async function handleSaveProfile() {
    setIsSavingProfile(true);
    setProfileMessage("");
    try {
      const headers = await getAuthHeaders();
      const body: Record<string, string | undefined> = {
        name: userName.trim() || undefined,
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        phone: userPhone.trim() || undefined,
        title: userTitle.trim() || undefined,
      };
      const res = await fetch(`${API_URL}/v1/me`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        profileOriginal.current = { name: userName.trim(), firstName: firstName.trim(), lastName: lastName.trim(), phone: userPhone.trim(), title: userTitle.trim() };
        setProfileMessage("Profile updated");
        setTimeout(() => setProfileMessage(""), 3000);
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

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setProfileMessage("Avatar must be under 2MB");
      return;
    }
    setIsUploadingAvatar(true);
    setProfileMessage("");
    try {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/v1/me/avatar`, {
        method: "POST",
        headers,
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setAvatarUrl(data.avatar_url);
        setProfileMessage("Avatar updated");
        setTimeout(() => setProfileMessage(""), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setProfileMessage(data.error || "Failed to upload avatar");
      }
    } catch {
      setProfileMessage("Failed to upload avatar");
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  /* ------ Render ------ */

  const inputPlaceholder = isLoading ? "Loading..." : "";

  return (
    <div className="px-4 sm:px-6 pb-24 md:pb-12">
      <div className="max-w-[600px] mx-auto pt-8 sm:pt-12">

        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-surface-container rounded-lg p-1 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-1 scrollbar-none">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 min-w-0 py-2.5 px-3 sm:px-4 rounded-md text-[12px] sm:text-[13px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-surface-container-lowest text-on-surface shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ============================================================ */}
        {/*  Organization Tab                                             */}
        {/* ============================================================ */}
        {activeTab === "organization" && (
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04),0_8px_32px_rgba(31,27,23,0.08)] p-6 sm:p-8">
            <div className="space-y-5">
              {/* Company Name */}
              <div>
                <FieldLabel htmlFor="org-name">Company Name</FieldLabel>
                <TextInput
                  id="org-name"
                  value={companyName}
                  onChange={setCompanyName}
                  placeholder={inputPlaceholder}
                />
              </div>

              {/* Phone */}
              <div>
                <FieldLabel htmlFor="org-phone">Phone</FieldLabel>
                <TextInput
                  id="org-phone"
                  value={companyPhone}
                  onChange={setCompanyPhone}
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                />
              </div>

              {/* Email */}
              <div>
                <FieldLabel htmlFor="org-email">Email</FieldLabel>
                <TextInput
                  id="org-email"
                  value={companyEmail}
                  onChange={setCompanyEmail}
                  type="email"
                  placeholder="office@company.com"
                />
              </div>

              {/* Address row */}
              <div>
                <FieldLabel htmlFor="org-address">Address</FieldLabel>
                <AddressAutocomplete
                  value={companyAddress}
                  onChange={setCompanyAddress}
                  onSelect={(parts) => {
                    setCompanyAddress(parts.address_line1);
                    setCompanyCity(parts.city);
                    setCompanyState(parts.state);
                    setCompanyZip(parts.zip);
                  }}
                  placeholder="Start typing an address..."
                  className="w-full h-12 px-4 rounded-lg bg-surface-container-low text-on-surface text-[15px] placeholder:text-outline transition-all duration-200 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest"
                />
              </div>

              {/* City / State / ZIP */}
              <div className="grid grid-cols-2 sm:grid-cols-[1fr_80px_100px] gap-3">
                <div>
                  <FieldLabel htmlFor="org-city">City</FieldLabel>
                  <TextInput
                    id="org-city"
                    value={companyCity}
                    onChange={setCompanyCity}
                    placeholder="City"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="org-state">State</FieldLabel>
                  <TextInput
                    id="org-state"
                    value={companyState}
                    onChange={setCompanyState}
                    placeholder="CA"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <FieldLabel htmlFor="org-zip">ZIP</FieldLabel>
                  <TextInput
                    id="org-zip"
                    value={companyZip}
                    onChange={setCompanyZip}
                    placeholder="90210"
                  />
                </div>
              </div>

              {/* Logo */}
              <div>
                <FieldLabel>Company Logo</FieldLabel>
                <label className="block h-28 rounded-lg bg-surface-container flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-surface-container-high transition-colors overflow-hidden relative">
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Company logo"
                      className="h-full w-full object-contain p-2"
                    />
                  ) : (
                    <>
                      <CameraIcon />
                      <span className="text-[13px] text-outline">
                        {isUploading ? "Uploading..." : "Click to upload logo"}
                      </span>
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

              {/* Subscription Tier */}
              <div>
                <FieldLabel>Subscription Tier</FieldLabel>
                <TierBadge tier={subscriptionTier} />
              </div>

              <StatusMessage message={orgMessage} />

              <SaveButton onClick={handleSaveOrg} isSaving={isSaving} disabled={!orgDirty} />
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/*  Profile Tab                                                  */}
        {/* ============================================================ */}
        {activeTab === "profile" && (
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04),0_8px_32px_rgba(31,27,23,0.08)] p-6 sm:p-8">
            <div className="space-y-5">
              {/* Avatar */}
              <div>
                <FieldLabel>Avatar</FieldLabel>
                <label className="inline-flex items-center gap-4 cursor-pointer group">
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-surface-container flex items-center justify-center ring-2 ring-transparent group-hover:ring-brand-accent/30 transition-all relative">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt="Your avatar"
                        className="w-16 h-16 rounded-full object-cover"
                      />
                    ) : (
                      <CameraIcon />
                    )}
                    {isUploadingAvatar && (
                      <div className="absolute inset-0 bg-surface/60 flex items-center justify-center rounded-full">
                        <span className="w-5 h-5 border-2 border-brand-accent/30 border-t-brand-accent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  <span className="text-[13px] text-on-surface-variant group-hover:text-on-surface transition-colors">
                    {isUploadingAvatar ? "Uploading..." : "Click to change avatar"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleAvatarUpload}
                    disabled={isUploadingAvatar}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Name */}
              <div>
                <FieldLabel htmlFor="profile-name">Name</FieldLabel>
                <TextInput
                  id="profile-name"
                  value={userName}
                  onChange={setUserName}
                  placeholder={inputPlaceholder}
                />
              </div>

              {/* First / Last Name row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <FieldLabel htmlFor="profile-first">First Name</FieldLabel>
                  <TextInput
                    id="profile-first"
                    value={firstName}
                    onChange={setFirstName}
                    placeholder={inputPlaceholder}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="profile-last">Last Name</FieldLabel>
                  <TextInput
                    id="profile-last"
                    value={lastName}
                    onChange={setLastName}
                    placeholder={inputPlaceholder}
                  />
                </div>
              </div>

              {/* Phone */}
              <div>
                <FieldLabel htmlFor="profile-phone">Phone</FieldLabel>
                <TextInput
                  id="profile-phone"
                  value={userPhone}
                  onChange={setUserPhone}
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                />
              </div>

              {/* Email (read-only) */}
              <ReadOnlyField
                label="Email"
                value={isLoading ? "Loading..." : userEmail}
              />

              {/* Title */}
              <div>
                <FieldLabel htmlFor="profile-title">Title</FieldLabel>
                <TextInput
                  id="profile-title"
                  value={userTitle}
                  onChange={setUserTitle}
                  placeholder="Owner, Project Manager, Technician..."
                />
              </div>

              {/* Role (read-only badge) */}
              <div>
                <FieldLabel>Role</FieldLabel>
                <RoleBadge role={userRole} />
              </div>

              <StatusMessage message={profileMessage} />

              <SaveButton
                onClick={handleSaveProfile}
                isSaving={isSavingProfile}
                disabled={!profileDirty}
                label="Save Profile"
              />
            </div>
          </section>
        )}

        {/* ============================================================ */}
        {/*  Team Tab                                                     */}
        {/* ============================================================ */}
        {activeTab === "team" && (
          <section className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04),0_8px_32px_rgba(31,27,23,0.08)] p-6 sm:p-8">
            <div className="flex flex-col items-center text-center py-8">
              <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center mb-4">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="9"
                    cy="7"
                    r="3"
                    stroke="#8d7168"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"
                    stroke="#8d7168"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="17"
                    cy="9"
                    r="2.5"
                    stroke="#8d7168"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M17 14c2.2 0 4 1.8 4 4"
                    stroke="#8d7168"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-on-surface mb-2">
                Team Management
              </h3>
              <p className="text-sm text-on-surface-variant max-w-xs">
                Invite technicians and manage your crew. Coming soon with team
                invitations and role management.
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
