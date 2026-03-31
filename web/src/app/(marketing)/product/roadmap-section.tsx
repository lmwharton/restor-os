"use client";

interface Feature {
  name: string;
  description: string;
}

interface Phase {
  id: string;
  label: string;
  tag: string;
  tagColor: string;
  tagBg: string;
  dotColor: string;
  features: Feature[];
}

const PHASES: Phase[] = [
  {
    id: "v1",
    label: "V1: AI Scope + Job Shell",
    tag: "Building Now",
    tagColor: "text-[#2a9d5c]",
    tagBg: "bg-[#edf7f0]",
    dotColor: "bg-[#2a9d5c]",
    features: [
      {
        name: "AI Photo Scope",
        description:
          "Upload damage photos, AI generates Xactimate line items with S500/OSHA justifications.",
      },
      {
        name: "Job Shell",
        description:
          "Create and manage jobs with customer, address, insurance, and loss details.",
      },
      {
        name: "PDF Reports",
        description:
          "Company-branded scope reports with line items, justifications, and photo grids.",
      },
      {
        name: "Auth",
        description:
          "Google OAuth signup. Single user per company in V1.",
      },
    ],
  },
  {
    id: "v2",
    label: "V2: Field Operations",
    tag: "Next Up",
    tagColor: "text-[#e85d26]",
    tagBg: "bg-[#fff3ed]",
    dotColor: "bg-[#e85d26]",
    features: [
      {
        name: "Moisture Tracking",
        description:
          "Atmospheric, point, and dehu readings with trend charts. Auto-GPP calculation.",
      },
      {
        name: "Voice Scoping",
        description:
          "AI-guided step-by-step voice scoping using Deepgram Nova-2 STT.",
      },
      {
        name: "Equipment Tracking",
        description:
          "Place/remove equipment by room, track count x days for billing.",
      },
      {
        name: "Scheduling & Dispatch",
        description:
          "Calendar board with My Schedule view. Push notifications.",
      },
      {
        name: "ESX Export",
        description:
          "Xactimate native file format for direct import.",
      },
      {
        name: "Team Management",
        description:
          "Invite techs, assign roles, job assignment, activity tracking.",
      },
      {
        name: "Digital Contracts",
        description:
          "E-signature for work authorization on site.",
      },
      {
        name: "Document Vault",
        description:
          "W-9, insurance certs, licenses — on deck for new carriers. Anything to get paid faster.",
      },
      {
        name: "Expanded Justifications",
        description:
          "Add IRC, IBC, S520, EPA, NIOSH standards — critical for build-back and reconstruction scoping.",
      },
      {
        name: "Supplement Trigger Engine",
        description:
          "AI monitors new photos against original scope, auto-drafts supplement requests when billable deviations detected.",
      },
    ],
  },
  {
    id: "v3",
    label: "V3: Intelligence Layer",
    tag: "Future",
    tagColor: "text-[#5b6abf]",
    tagBg: "bg-[#eef0fc]",
    dotColor: "bg-[#5b6abf]",
    features: [
      {
        name: "Carrier-Specific AI Rules",
        description:
          "Per-TPA rule sets (Alacrity, Code Blue, Sedgwick) embedded in the AI pipeline.",
      },
      {
        name: "Rejection Predictor",
        description:
          "AI flags line items likely to be denied based on carrier history.",
      },
      {
        name: "Auto Adjuster Reports",
        description:
          "Daily auto-generated updates sent to adjusters with a limited-access token.",
      },
    ],
  },
];

export function RoadmapSection() {
  return (
    <div>
      <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] mb-3">
        Roadmap
      </h2>
      <p className="text-[14px] text-[#8a847e] mb-6">
        Three phases from MVP to intelligence layer.
      </p>

      <div className="space-y-8">
        {PHASES.map((phase) => (
          <div key={phase.id}>
            {/* Phase header */}
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-[15px] font-semibold text-[#1a1a1a]">
                {phase.label}
              </h3>
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full ${phase.tagBg} ${phase.tagColor}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${phase.dotColor}`}
                />
                {phase.tag}
              </span>
            </div>

            {/* Feature rows */}
            <div className="space-y-0">
              {phase.features.map((feature, i) => (
                <div
                  key={feature.name}
                  className={`flex items-start gap-3 py-3 ${
                    i < phase.features.length - 1
                      ? "border-b border-[#eae6e1]"
                      : ""
                  }`}
                >
                  <span className="text-[14px] font-semibold text-[#1a1a1a] shrink-0">
                    {feature.name}
                  </span>
                  <span className="text-[13px] text-[#8a847e] leading-relaxed">
                    {feature.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
