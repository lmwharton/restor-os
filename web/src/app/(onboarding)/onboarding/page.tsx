"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function WaterDropIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M14 3C14 3 6 12.5 6 17.5C6 22 9.58 25 14 25C18.42 25 22 22 22 17.5C22 12.5 14 3 14 3Z"
        fill="url(#dropGrad)"
        stroke="#a63500"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="dropGrad" x1="6" y1="3" x2="22" y2="25" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e85d26" stopOpacity="0.15" />
          <stop offset="1" stopColor="#a63500" stopOpacity="0.08" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function AutomatedIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="#a63500" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DataDrivenIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="12" width="4" height="8" rx="1" stroke="#a63500" strokeWidth="1.5" />
      <rect x="10" y="8" width="4" height="12" rx="1" stroke="#a63500" strokeWidth="1.5" />
      <rect x="17" y="4" width="4" height="16" rx="1" stroke="#a63500" strokeWidth="1.5" />
    </svg>
  );
}

function FieldFastIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#a63500" strokeWidth="1.5" />
      <path d="M12 7v5l3 3" stroke="#a63500" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) return;
    setIsSubmitting(true);
    setError("");

    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setError("Your session has expired. Please sign in again.");
        setIsSubmitting(false);
        return;
      }

      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${API_URL}/v1/company`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name: companyName.trim(),
          phone: phone.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || "Failed to create company");
      }

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Glassmorphism header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-surface/70 border-b border-outline-variant/30">
        <div className="max-w-[640px] mx-auto w-full px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WaterDropIcon />
            <span className="text-[17px] font-semibold tracking-[-0.45px] text-on-surface">
              crewmatic
            </span>
          </div>
          <Link
            href="/support"
            className="text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors font-[family-name:var(--font-geist-mono)] uppercase tracking-wide"
          >
            Help
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-[480px]">
          {/* Card */}
          <div className="bg-surface-container-lowest rounded-xl shadow-[0_1px_3px_rgba(31,27,23,0.04),0_8px_32px_rgba(31,27,23,0.08)] p-8 sm:p-10">
            <h1 className="text-[2rem] sm:text-[2.75rem] font-bold tracking-[-1.5px] leading-[1.05] text-on-surface mb-3">
              Create your workspace
            </h1>
            <p className="text-[15px] text-on-surface-variant leading-relaxed mb-8">
              Tell us about your company so we can customize Crewmatic for you.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Company Name */}
              <div>
                <label
                  htmlFor="company-name"
                  className="block text-[11px] font-semibold tracking-[0.1em] uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]"
                >
                  Company Name
                </label>
                <input
                  id="company-name"
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Restoration Pro Services"
                  className="w-full h-12 px-4 rounded-lg bg-surface-container-low text-on-surface text-[15px] placeholder:text-outline transition-all duration-200 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest"
                />
              </div>

              {/* Phone */}
              <div>
                <label
                  htmlFor="phone"
                  className="block text-[11px] font-semibold tracking-[0.1em] uppercase text-on-surface-variant mb-2 font-[family-name:var(--font-geist-mono)]"
                >
                  Phone Number{" "}
                  <span className="text-outline font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full h-12 px-4 rounded-lg bg-surface-container-low text-on-surface text-[15px] placeholder:text-outline transition-all duration-200 outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest"
                />
              </div>

              {/* Error message */}
              {error && (
                <p className="text-sm text-red-500 text-center">{error}</p>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting || !companyName.trim()}
                className="w-full h-14 rounded-xl text-[15px] font-semibold text-on-primary bg-brand-accent cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <span className="inline-block w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    Continue
                    <span aria-hidden="true" className="text-[18px]">&rarr;</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer text */}
          <p className="text-center text-[11px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-outline mt-8">
            Precision Scoping Powered by{" "}
            <Link href="/" className="text-primary hover:underline underline-offset-2">
              Crewmatic
            </Link>
          </p>

          {/* Decorative icons */}
          <div className="flex items-center justify-center gap-6 sm:gap-10 mt-6">
            {[
              { icon: <AutomatedIcon />, label: "Automated" },
              { icon: <DataDrivenIcon />, label: "Data-Driven" },
              { icon: <FieldFastIcon />, label: "Field-Fast" },
            ].map((item) => (
              <div key={item.label} className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-surface-container flex items-center justify-center">
                  {item.icon}
                </div>
                <span className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.08em] text-outline">
                  {item.label}
                </span>
              </div>
            ))}
          </div>

        </div>
      </main>
    </div>
  );
}
