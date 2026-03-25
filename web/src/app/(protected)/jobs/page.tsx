"use client";

import { Plus } from "@/components/icons";

/* ------------------------------------------------------------------ */
/*  Inline Icons (page-specific)                                       */
/* ------------------------------------------------------------------ */

function ClipboardIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="8" y="4" width="16" height="24" rx="2.5" stroke="#a63500" strokeWidth="1.5" />
      <path d="M12 4h8v2a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V4z" fill="#a63500" opacity="0.15" stroke="#a63500" strokeWidth="1.5" />
      <path d="M12 13h8M12 17h6M12 21h4" stroke="#a63500" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function JobsPage() {
  return (
    <>
      {/* Main content -- empty state */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 md:py-24 relative">
        {/* Subtle background shape */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full opacity-30 blur-[120px] pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(232,93,38,0.08) 0%, transparent 70%)",
          }}
          aria-hidden="true"
        />

        <div className="relative flex flex-col items-center text-center max-w-md">
          {/* Icon */}
          <div className="w-16 h-16 rounded-2xl bg-surface-container flex items-center justify-center mb-6">
            <ClipboardIcon />
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-[-1px] text-on-surface mb-3">
            No jobs yet.
          </h1>
          <p className="text-[15px] text-on-surface-variant leading-relaxed mb-8 max-w-sm">
            Create your first job to start AI scoping and real-time field data
            monitoring.
          </p>

          {/* Create Job button */}
          <button
            onClick={() => {
              // TODO: Open create job modal or navigate to create job page
              console.log("Create job");
            }}
            className="h-12 px-8 rounded-xl text-[15px] font-semibold text-on-primary primary-gradient cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] flex items-center gap-2"
          >
            <Plus size={18} />
            Create Job
          </button>

          {/* How it works link */}
          <button
            onClick={() => {
              // TODO: Show how-it-works modal or section
              console.log("How it works");
            }}
            className="mt-4 text-[13px] font-medium text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
          >
            How it works
          </button>
        </div>
      </div>
    </>
  );
}
