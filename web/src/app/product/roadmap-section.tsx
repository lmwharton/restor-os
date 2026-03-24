"use client";

import { useState } from "react";

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
  borderColor: string;
  features: Feature[];
}

const PHASES: Phase[] = [
  {
    id: "v1",
    label: "V1: AI Scope + Job Shell",
    tag: "Building Now",
    tagColor: "text-emerald-700",
    tagBg: "bg-emerald-50 border-emerald-200",
    borderColor: "border-l-emerald-500",
    features: [
      {
        name: "AI Photo Scope",
        description:
          "Upload damage photos, AI generates Xactimate line items with S500/OSHA justifications. The core product capability -- no competitor has this.",
      },
      {
        name: "Job Shell",
        description:
          "Create and manage jobs with customer, address, insurance, and loss details. The data backbone that makes Photo Scope a product, not a demo.",
      },
      {
        name: "PDF Reports",
        description:
          "Company-branded scope reports with line items, justifications, and photo grids. PDF is the default format adjusters expect.",
      },
      {
        name: "Auth",
        description:
          "Google OAuth via Supabase. Single user per company in V1. Company onboarding on first login.",
      },
    ],
  },
  {
    id: "v2",
    label: "V2: Field Operations",
    tag: "Next Up",
    tagColor: "text-amber-700",
    tagBg: "bg-amber-50 border-amber-200",
    borderColor: "border-l-amber-400",
    features: [
      {
        name: "Moisture Tracking",
        description:
          "Atmospheric, point, and dehu readings with trend charts. Auto-GPP calculation -- currently requires a separate app.",
      },
      {
        name: "Voice Scoping",
        description:
          "AI-guided step-by-step voice scoping using Deepgram Nova-2 STT. Hands-free for techs wearing gloves and masks.",
      },
      {
        name: "Equipment Tracking",
        description:
          "Place/remove equipment by room, track count x days for billing. Photo corroboration for adjuster verification.",
      },
      {
        name: "Scheduling & Dispatch",
        description:
          'Calendar board with "My Schedule" view. Push notifications. Replaces the 11pm group text asking who can take tomorrow\'s job.',
      },
      {
        name: "ESX Export",
        description:
          "Xactimate native file format for direct import. Eliminates manual re-entry of line items into Xactimate.",
      },
      {
        name: "Team Management",
        description:
          "Invite techs, assign roles (owner > admin > tech), job assignment, activity tracking.",
      },
      {
        name: "Digital Contracts",
        description:
          "E-signature for work authorization. Replaces paper contracts signed on site.",
      },
    ],
  },
  {
    id: "v3",
    label: "V3: Intelligence Layer",
    tag: "Future",
    tagColor: "text-slate-500",
    tagBg: "bg-slate-50 border-slate-200",
    borderColor: "border-l-slate-300",
    features: [
      {
        name: "Carrier-Specific AI Rules",
        description:
          "Per-TPA rule sets (Alacrity, Code Blue, Sedgwick) embedded in the AI pipeline. Reduces first-submission rejections.",
      },
      {
        name: "Rejection Predictor",
        description:
          "AI flags line items likely to be denied based on carrier history and TPA guidelines before submission.",
      },
      {
        name: "Auto Adjuster Reports",
        description:
          "Daily auto-generated updates sent to adjusters with a limited-access token. Speeds payment and builds trust.",
      },
    ],
  },
];

export function RoadmapSection() {
  const [expandedPhase, setExpandedPhase] = useState<string>("v1");

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Feature Roadmap</h2>
        <p className="text-sm text-slate-500 mt-1">
          Three phases from MVP to intelligence layer
        </p>
      </div>

      {/* Phase selector tabs */}
      <div className="flex gap-2 mb-6">
        {PHASES.map((phase) => (
          <button
            key={phase.id}
            onClick={() =>
              setExpandedPhase(expandedPhase === phase.id ? "" : phase.id)
            }
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              expandedPhase === phase.id
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            {phase.id.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Phase cards */}
      <div className="space-y-4">
        {PHASES.map((phase) => {
          const isExpanded = expandedPhase === phase.id;

          return (
            <div
              key={phase.id}
              className={`bg-white rounded-xl border border-slate-200 overflow-hidden transition-all duration-200 border-l-4 ${phase.borderColor} ${
                isExpanded ? "shadow-sm" : ""
              }`}
            >
              <button
                onClick={() =>
                  setExpandedPhase(isExpanded ? "" : phase.id)
                }
                className="w-full text-left px-5 py-4 flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] text-slate-300 group-hover:text-slate-500 transition-all duration-200 ${
                      isExpanded ? "rotate-90 text-blue-500" : ""
                    }`}
                  >
                    {"\u25B6"}
                  </span>
                  <h3 className="text-[15px] font-semibold text-slate-800">
                    {phase.label}
                  </h3>
                  <span
                    className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium ${phase.tagBg} ${phase.tagColor}`}
                  >
                    {phase.tag}
                  </span>
                </div>
                <span className="text-xs text-slate-400">
                  {phase.features.length} features
                </span>
              </button>

              {isExpanded && (
                <div className="px-5 pb-5">
                  <div className="border-t border-slate-100 pt-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {phase.features.map((feature) => (
                        <div
                          key={feature.name}
                          className="rounded-lg border border-slate-100 p-4 hover:border-slate-200 transition-colors"
                        >
                          <h4 className="text-sm font-semibold text-slate-800 mb-1.5">
                            {feature.name}
                          </h4>
                          <p className="text-[12px] text-slate-500 leading-relaxed">
                            {feature.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
