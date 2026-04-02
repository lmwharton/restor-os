"use client";

import { useState } from "react";

interface Step {
  text: string;
  detail?: string;
}

type SpecStatus = "implemented" | "in-progress" | "draft" | "not-started";

interface Functionality {
  id: string;
  number: number;
  name: string;
  tagline: string;
  painPoint?: string;
  steps: Step[];
  aiPowered?: boolean;
  noCompetitor?: boolean;
  brettQuote?: string;
  specRef?: string;
  specStatus?: SpecStatus;
}

const STATUS_STYLES: Record<SpecStatus, { bg: string; text: string; label: string }> = {
  implemented: { bg: "bg-[#edf7f0]", text: "text-[#2a9d5c]", label: "Implemented" },
  "in-progress": { bg: "bg-[#fff3ed]", text: "text-[#e85d26]", label: "In Progress" },
  draft: { bg: "bg-[#f3eeff]", text: "text-[#7c5cbf]", label: "Spec Ready" },
  "not-started": { bg: "bg-[#faf9f7]", text: "text-[#8a847e]", label: "Planned" },
};

const FUNCTIONALITIES: Functionality[] = [
  {
    id: "job-creation-dispatch",
    number: 1,
    name: "Job Creation & Dispatch",
    specRef: "01 (Jobs) + 04B (Dispatch)",
    specStatus: "implemented",
    tagline:
      "Emergency call comes in — capture job details, assign a tech, and dispatch them with push notifications. No more late-night group texts.",
    painPoint:
      "Brett's #1 pain point: 'I'm sending texts late at night telling everyone if they're gonna be in.' Currently juggling calls, sticky notes, and group texts.",
    steps: [
      {
        text: "Receive call from customer or TPA (Alacrity, Accuserve, Sedgwick)",
        detail: "TPA calls handled by office; direct calls by owner or tech",
      },
      {
        text: "Create job with customer name, address, phone",
      },
      {
        text: "Add insurance details — carrier, claim number, adjuster name/phone/email",
        detail:
          "Not mandatory upfront. App flags 'basement + no insurance' as a risk",
      },
      {
        text: "Record loss details — type, cause, date of loss",
        detail:
          "Category/class determined on-site, not on the call. Dispatcher needs equipment/situation info instead",
      },
      {
        text: "Owner views scheduling board — drag-and-drop to assign tech(s) with date/time",
      },
      {
        text: "Tech receives push notification with job details and address",
      },
      {
        text: "Tech opens 'My Schedule' — sees today's jobs, tomorrow's jobs",
      },
      {
        text: "Owner sees real-time status: who's en route, who's on-site, who's done",
      },
    ],
    brettQuote:
      "We have the right equipment, right tools, right people — it's expected. We just need to reduce the unpredictability.",
  },
  {
    id: "site-assessment",
    number: 2,
    name: "Site Arrival & Assessment",
    specRef: "01 (Jobs) + 04B (GPS Check-in)",
    specStatus: "implemented",
    tagline:
      "Arrive on site, connect with the homeowner first, then systematically assess damage room by room.",
    steps: [
      {
        text: "GPS logs arrival time automatically",
      },
      {
        text: "Talk to homeowner first — empathy before documentation",
        detail:
          "These people are having the worst moment of their life. Show care, THEN assess",
      },
      {
        text: "Walk property to identify all affected rooms",
      },
      {
        text: "Identify damage source and affected materials",
      },
      {
        text: "Create room list with dimensions (laser measure or tape)",
        detail:
          "Optional on first visit — not everyone measures immediately. V2: LiDAR via iPhone",
      },
      {
        text: "Determine water category (1/2/3) and class (1-4) based on what you see",
      },
    ],
    brettQuote:
      "These people, it's the worst moment in their life. Talk to them first, show care, THEN assess damage.",
  },
  {
    id: "photo-documentation",
    number: 3,
    name: "Photo Documentation",
    specRef: "01 (Jobs)",
    specStatus: "implemented",
    tagline:
      "Every photo auto-tagged with GPS, auto-associated to the active job, organized by room and type. ~60 photos per job.",
    painPoint:
      "Techs currently bounce between CompanyCam, Google Drive, and their camera roll.",
    steps: [
      {
        text: "Open camera within the job — photos auto-associate to the active job",
      },
      {
        text: "Photos auto-tagged with GPS coordinates (like CompanyCam)",
      },
      {
        text: "Tag photos by type: damage, equipment, protection, containment, moisture reading, before/after",
      },
      {
        text: "Assign photos to specific rooms",
      },
      {
        text: "~60 photos per job: ~25 damage photos (for AI) + ~35 proof-of-work shots",
      },
      {
        text: "Offline capture with auto-upload when back on network",
      },
      {
        text: "Searchable archive by location — find past work by address",
        detail:
          "Brett uses iCloud to search 'what did we do at 12 Mile and Van Dyke'",
      },
    ],
    brettQuote:
      "CompanyCam's auto-location logging was very smooth, very catchy — that's table stakes.",
  },
  {
    id: "ai-photo-scope",
    number: 4,
    name: "AI Photo Scope",
    specRef: "02 (AI Pipeline)",
    specStatus: "draft",
    tagline:
      "Select damage photos, tap one button, get Xactimate line items with S500/OSHA justifications in seconds.",
    painPoint:
      "Manual Xactimate entry takes 2-4 hours per job. This collapses it to minutes.",
    aiPowered: true,
    noCompetitor: true,
    steps: [
      {
        text: "Select ~25 damage photos from the job",
      },
      {
        text: "Tap 'Run AI Photo Scope'",
      },
      {
        text: "AI analyzes photos using Claude Vision with Xactimate code reference, S500 standards, and OSHA regulations",
      },
      {
        text: "AI returns structured line items: Xactimate code, description, quantity, unit, S500/OSHA justification",
      },
      {
        text: "Non-obvious items flagged — things the tech would have missed (HEPA filters, baseboard removal, PPE, consumables)",
      },
      {
        text: "Review each item: approve, edit quantity, or reject",
      },
      {
        text: "Re-run on additional photos as more damage is discovered over days",
        detail:
          "Damage discovery is progressive — new items merge with existing scope, duplicates auto-deduplicated",
      },
    ],
    brettQuote:
      "This is an absolute game changer. The fact that you can take a photo and create an estimate is amazing. It would be great if it could find line items you don't typically think of.",
  },
  {
    id: "ai-hazmat",
    number: 5,
    name: "AI Hazmat Scanner",
    specRef: "02 (AI Pipeline)",
    specStatus: "draft",
    tagline:
      "Every photo auto-scanned for asbestos-risk materials and lead paint. Flags dangers before techs touch anything.",
    aiPowered: true,
    noCompetitor: true,
    steps: [
      {
        text: "Photos auto-scanned in background as they're captured",
      },
      {
        text: "AI identifies asbestos-risk materials: popcorn ceilings, 9x9 vinyl tiles, pipe insulation, vermiculite, transite siding",
        detail: "Targets pre-1980s homes where asbestos is most common",
      },
      {
        text: "AI identifies lead paint indicators: chipping paint, windowsills, trim in pre-1978 homes",
      },
      {
        text: "Flagged photos show warning with recommended action",
      },
      {
        text: "Links to test kit purchase and local abatement contractor referrals",
        detail:
          "Revenue model: test kit manufacturers and abatement contractors pay for placement",
      },
    ],
    brettQuote:
      "Don't think you have to do this right away even though it would be nice — but it's valuable.",
  },
  {
    id: "scoping",
    number: 6,
    name: "Scoping (Voice & Manual)",
    specRef: "03 (Voice)",
    specStatus: "draft",
    tagline:
      "Speak naturally in any order \u2014 AI extracts and maps to the right fields in real-time. Or use manual keyboard entry with smart Xactimate code search. Every line item auto-backed by S500/OSHA.",
    painPoint:
      "Contractors can\u2019t type with gloves on in a wet basement. A guided form approach (field-by-field prompts) doesn\u2019t match how techs actually talk \u2014 they jump between rooms, backtrack, and describe things out of order. Voice input must handle free-form speech or it won\u2019t be used.",
    aiPowered: true,
    steps: [
      {
        text: "Voice mode: speak naturally in any order \u2014 AI extracts and maps to the correct fields automatically",
        detail:
          "No rigid question sequence. Describe damage, rooms, materials in whatever order comes naturally. AI handles the structure.",
      },
      {
        text: "Two input modes: Continuous (mic stays hot, hands-free) and Push-to-Talk (for noisy job sites)",
      },
      {
        text: "Fields lock green when AI confirms the capture; yellow with flag when ambiguous for review",
      },
      {
        text: "Spelling recognition: say \u2018spelled K-O-V-I-N-A-C-K\u2019 and AI applies it to the last captured name",
      },
      {
        text: "Session log shows everything captured so the tech can track what\u2019s been processed",
      },
      {
        text: "Manual mode: search Xactimate codes by keyword with fuzzy matching and category grouping",
        detail:
          "50+ water damage codes organized by workflow: tear-out \u2192 protect \u2192 clean \u2192 dry \u2192 monitor \u2192 decon",
      },
      {
        text: "S500/OSHA justification auto-attached to every line item",
        detail:
          "This is a revenue tool: \u2018OSHA requires this\u2019 wins payment disputes with adjusters",
      },
      {
        text: "Typical job: 10-30 line items total",
      },
    ],
    brettQuote:
      "I would use voice all the time if it actually accurately tracked everything. My hands are literally occupied. When any line item needs justification with S500 or OSHA backing, I've already input that.",
  },
  {
    id: "room-sketching",
    number: 7,
    name: "Room Sketching",
    specRef: "01C (Floor Plan Konva)",
    specStatus: "in-progress",
    tagline:
      "Draw floor plans with affected areas, equipment placement, and moisture point markers. Export compatible with Xactimate.",
    steps: [
      {
        text: "Create room sketch with dimensions (length × width)",
      },
      {
        text: "Mark affected areas on the floor plan",
      },
      {
        text: "Place equipment markers (air movers, dehus, air scrubbers)",
      },
      {
        text: "Mark moisture reading points for reference",
      },
      {
        text: "Export compatible with Xactimate",
        detail:
          "V2: LiDAR integration via iPhone for instant room measurements",
      },
    ],
    brettQuote:
      "Pretty important. At minimum they would need to know dimensions or square footage. You could submit without one but might not get paid very quickly.",
  },
  {
    id: "equipment-tracking",
    number: 8,
    name: "Equipment Tracking",
    specRef: "04C (Equipment & Drying Cert)",
    specStatus: "draft",
    tagline:
      "Log equipment by type and count. Track placement and removal dates. App auto-suggests sizing based on S500 formula. Bill by count × days.",
    steps: [
      {
        text: "Log equipment by type: air movers, dehumidifiers (regular/large/XL), air scrubbers, cavity dryers",
      },
      {
        text: "Record placement date and removal date per piece",
      },
      {
        text: "App auto-suggests equipment count based on room size and S500 formula",
        detail:
          "Standard: 1 XL dehu per 7-8 air movers per ~1,000 SF. Citation makes it undeniable to adjusters",
      },
      {
        text: "Photos must corroborate equipment count — adjusters cross-reference",
      },
      {
        text: "Billing calculated as count × days — serial numbers don't matter",
      },
    ],
    brettQuote:
      "Adjusters care about count times days, NOT serial numbers. Photos must corroborate equipment count.",
  },
  {
    id: "site-log-monitoring",
    number: 9,
    name: "Site Log & Daily Monitoring",
    specRef: "01 (Jobs)",
    specStatus: "implemented",
    tagline:
      "Track moisture readings, equipment status, and drying progress across multiple days. Auto-calculate GPP. Trend charts replace paper logs and memory.",
    painPoint:
      "Brett does GPP calculation in a separate app at home. Readings tracked on paper. Drying progress communicated verbally: 'I was at 180s, hopefully not 130 today.'",
    steps: [
      {
        text: "Take atmospheric reading per room: temperature + relative humidity",
      },
      {
        text: "App auto-calculates GPP (Grains Per Pound) — no separate app needed",
        detail:
          "Brett used a separate Psychrometric Chart app (now deleted from store) — clear market gap",
      },
      {
        text: "Log ~5 moisture points per wall across different materials and locations",
      },
      {
        text: "Record dehu output readings (exhaust air temp and RH)",
        detail:
          "Delta between atmospheric and dehu outlet shows how hard the machine is working",
      },
      {
        text: "Return daily: open job, see yesterday's readings side-by-side with today's",
      },
      {
        text: "Check equipment status — all running? Any need repositioning?",
      },
      {
        text: "Take progress photos (auto-tagged as 'during')",
      },
      {
        text: "App shows drying trend charts — flags plateaus where readings stop improving",
      },
      {
        text: "Dry standard: readings match unaffected area of same material → equipment can be pulled",
      },
    ],
    brettQuote:
      "I compare to yesterday — it's a mental thing for me. I let the tech know 'I was at 180s, hopefully not 130 today.'",
  },
  {
    id: "job-review",
    number: 10,
    name: "Job Review & QA",
    specRef: "02 (AI Pipeline)",
    specStatus: "draft",
    tagline:
      "Before submitting to the adjuster, the owner reviews everything the tech documented. AI flags missing items.",
    aiPowered: true,
    steps: [
      {
        text: "Owner opens completed job for review",
      },
      {
        text: "Check photos — are they comprehensive? All rooms covered?",
      },
      {
        text: "Check readings — do trends make sense? Drying confirmed?",
      },
      {
        text: "Check scope — all line items present? Quantities correct?",
      },
      {
        text: "Edit, add, or delete items as needed",
      },
      {
        text: "AI completeness check flags missing items before submission",
        detail:
          "Did you forget baseboard removal? Equipment decon? Consumables?",
      },
    ],
  },
  {
    id: "reports",
    number: 11,
    name: "Report Generation",
    specRef: "01 (Jobs) + 05 (ESX Export)",
    specStatus: "implemented",
    tagline:
      "One tap generates a prosecution-grade PDF with branded header, line items, S500/OSHA justifications, and photo grids.",
    steps: [
      {
        text: "Select job and tap 'Generate Report'",
      },
      {
        text: "Company-branded header: logo, company name, phone number",
      },
      {
        text: "Job details: address, date, homeowner, insurance info",
      },
      {
        text: "Line item table: Xactimate code, description, quantity, unit, S500/OSHA justification",
      },
      {
        text: "Photo thumbnail grid organized by room and type",
      },
      {
        text: "Moisture trend charts and equipment log summary",
      },
      {
        text: "Export as PDF (default)",
        detail:
          "ESX export (Xactimate native format) planned for V2 — eliminates manual re-entry into Xactimate",
      },
    ],
    brettQuote:
      "Photos are the biggest one to get paid. You absolutely need it. PDF is default — ESX feels weird because adjusters can manipulate it.",
  },
  {
    id: "auto-adjuster-reports",
    number: 12,
    name: "Auto Adjuster Reports",
    specRef: "04E (Daily Auto-Reports)",
    specStatus: "draft",
    tagline:
      "Daily progress updates auto-sent to the adjuster via secure link. Limited access — they see status, not everything.",
    noCompetitor: true,
    steps: [
      {
        text: "While job is active, app auto-generates daily progress summary",
      },
      {
        text: "Adjuster receives secure email link — no login required",
      },
      {
        text: "Adjuster sees: job status, selected photos, latest moisture readings, equipment status",
        detail: "View-only, no edit access. Owner controls what's visible",
      },
      {
        text: "Customer gets an even more limited view — just status + selected photos",
      },
      {
        text: "Proactive communication = faster payment approval",
      },
    ],
    brettQuote:
      "Auto-sends to the adjuster on a daily basis with limited access. They get some picture but not all. This is a revenue tool.",
  },
  {
    id: "team-dashboard",
    number: 13,
    name: "Team Management & Dashboard",
    specRef: "04A (Team Management)",
    specStatus: "draft",
    tagline:
      "Invite techs, assign roles, control what they see. At-a-glance dashboard: active jobs, schedule, equipment deployed, metrics.",
    painPoint:
      "Right now techs bounce between Google Drive, Notes, and email — all these different things cause issues.",
    steps: [
      {
        text: "Owner invites techs by email — tech creates account and joins the company",
      },
      {
        text: "Three roles: Owner (sees everything), Admin (manages jobs), Tech (sees assigned jobs only)",
      },
      {
        text: "Owner assigns techs to jobs — tech sees only their work",
      },
      {
        text: "Activity feed shows who did what, when",
      },
      {
        text: "Dashboard: active jobs count + status breakdown (needs scope, scoped, submitted, paid)",
      },
      {
        text: "Today's schedule — who's where, what's next",
      },
      {
        text: "Equipment deployed — total count across all active jobs",
      },
      {
        text: "Key metrics — revenue, average days to payment, AI scope accuracy",
      },
    ],
    brettQuote:
      "If this is THE app and this is what I expect them to do, there should be no problem. Right now I need them to go on Google Drive, then Notes, then check email — all these different things cause issues.",
  },
  {
    id: "reconstruction",
    number: 14,
    name: "Insurance Repair (Reconstruction)",
    tagline:
      "The natural second half of every water/fire/storm job. Same claim, same adjuster — separate job type with phase tracking, supplement management, and ACV/RCV holdback tracking.",
    specRef: "01B (Reconstruction) + 05 Phase 5",
    specStatus: "draft",
    aiPowered: true,
    steps: [
      {
        text: "Job mode selector: Restoration Only / Insurance Repair Only / Restoration + Repair",
        detail:
          "Mode can change mid-job when carrier confirms rebuild scope",
      },
      {
        text: "Reconstruction scope builder with full Xactimate division coverage",
        detail:
          "Drywall, framing, flooring, painting, cabinetry, millwork, roofing, windows, doors, insulation, HVAC, plumbing, electrical",
      },
      {
        text: "Mitigation-to-reconstruction handoff — pre-populate scope from mitigation phase",
      },
      {
        text: "Phase tracking: Demo → Structural → Rough Mechanical → Insulation → Drywall → Paint → Finish → Walkthrough",
      },
      {
        text: "Supplement management — AI drafts supplements when new damage is discovered during demo",
      },
      {
        text: "ACV/RCV holdback tracking and release requests per phase milestone",
      },
      {
        text: "Certificate of Completion triggers final holdback release",
      },
    ],
    brettQuote:
      "80% of the time the same company handles mitigation and reconstruction. Two jobs, two invoices — always. Different crews, different margins.",
  },
  {
    id: "growth-engine",
    number: 15,
    name: "Growth Engine",
    tagline:
      "Crewmatic doesn't just help contractors manage work — it helps them bring in new revenue. Gamified referral loyalty, automated drip campaigns, and SEO/social automation.",
    specRef: "05 Phase 9 (Revenue Generation)",
    specStatus: "draft",
    steps: [
      {
        text: "Tier-based referral loyalty program for plumbers, property managers, and other trades",
        detail:
          "Inspired by Duolingo streaks, Marriott Bonvoy status, and United MileagePlus. Higher tiers unlock better per-referral payouts and priority scheduling.",
      },
      {
        text: "Streak mechanics — consecutive referral weeks build streaks with loss aversion",
      },
      {
        text: "Automated drip campaigns via SMS + email to referral partners",
        detail:
          "Onboarding, nurture, win-back, and tier-up celebration sequences",
      },
      {
        text: "SEO & geo audit for contractor's online presence",
        detail:
          "Google Business Profile optimization, social presence scoring, local search visibility",
      },
      {
        text: "Social presence automation — auto-generate job completion posts, before/after galleries",
      },
      {
        text: "Revenue attribution dashboard — see which referral channels generate the most revenue",
      },
    ],
    brettQuote:
      "We're not just helping contractors manage their workflow — we're helping them bring in new revenue.",
  },
];

export function ProductFunctionalities() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div>
      <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-2">
        All Functionalities
      </h2>
      <p className="text-[14px] text-[#8a847e] mb-1">
        Every capability Crewmatic will offer, ordered by the natural workflow a
        contractor follows from first call to getting paid, plus reconstruction
        and revenue growth.
      </p>
      <p className="text-[13px] text-[#b5b0aa] mb-6">
        Based on 16 validated workflows from co-founder Brett Sodders &mdash; 15
        years in restoration.
      </p>

      <div className="space-y-0">
        {FUNCTIONALITIES.map((func, i) => {
          const isExpanded = expandedId === func.id;

          return (
            <div
              key={func.id}
              className={`border-b border-[#eae6e1] ${i === 0 ? "border-t" : ""}`}
            >
              {/* Header row */}
              <button
                onClick={() =>
                  setExpandedId(isExpanded ? null : func.id)
                }
                className="w-full text-left py-4 flex items-start gap-3 group"
              >
                <span className="text-[13px] font-mono text-[#b5b0aa] tabular-nums shrink-0 mt-0.5 w-6 text-right">
                  {func.number}.
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-semibold text-[#1a1a1a] group-hover:text-[#e85d26] transition-colors">
                      {func.name}
                    </span>
                    {func.specStatus && (
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[func.specStatus].bg} ${STATUS_STYLES[func.specStatus].text}`}>
                        {STATUS_STYLES[func.specStatus].label}
                      </span>
                    )}
                    {func.aiPowered && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#f3eeff] text-[#7c5cbf]">
                        AI-Powered
                      </span>
                    )}
                    {func.noCompetitor && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#fff3ed] text-[#e85d26]">
                        No Competitor Has This
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-[#6b6560] leading-relaxed mt-0.5">
                    {func.tagline}
                  </p>
                </div>
                <span
                  className={`text-[10px] text-[#b5b0aa] group-hover:text-[#e85d26] transition-all duration-200 shrink-0 mt-1.5 ${
                    isExpanded ? "rotate-90 text-[#e85d26]" : ""
                  }`}
                >
                  &#9654;
                </span>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="pb-5 pl-9 pr-4">
                  {func.painPoint && (
                    <div className="mb-4 px-3 py-2.5 bg-[#fff8f5] border-l-2 border-[#e85d26] rounded-r">
                      <p className="text-[12px] text-[#8a847e] font-medium mb-0.5">
                        Pain point this solves
                      </p>
                      <p className="text-[13px] text-[#171717] leading-relaxed">
                        {func.painPoint}
                      </p>
                    </div>
                  )}

                  <p className="text-[12px] font-medium text-[#8a847e] uppercase tracking-wide mb-2">
                    User Journey
                  </p>
                  <div className="space-y-0">
                    {func.steps.map((step, si) => (
                      <div
                        key={si}
                        className={`flex items-start gap-2.5 py-2 ${
                          si < func.steps.length - 1
                            ? "border-b border-[#f0ede9]"
                            : ""
                        }`}
                      >
                        <span className="w-5 h-5 rounded-full bg-[#faf9f7] border border-[#eae6e1] text-[10px] font-mono text-[#8a847e] flex items-center justify-center shrink-0 mt-0.5">
                          {si + 1}
                        </span>
                        <div>
                          <p className="text-[13px] text-[#171717] leading-relaxed">
                            {step.text}
                          </p>
                          {step.detail && (
                            <p className="text-[12px] text-[#b5b0aa] leading-relaxed mt-0.5">
                              {step.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {func.brettQuote && (
                    <div className="mt-4 px-3 py-2.5 bg-[#faf9f7] rounded-lg border border-[#eae6e1]">
                      <p className="text-[12px] text-[#8a847e] italic leading-relaxed">
                        &ldquo;{func.brettQuote}&rdquo;
                      </p>
                      <p className="text-[11px] text-[#b5b0aa] mt-1">
                        &mdash; Brett Sodders, Co-founder
                      </p>
                    </div>
                  )}

                  {func.specRef && (
                    <p className="mt-3 text-[11px] text-[#b5b0aa]">
                      Spec: {func.specRef}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
