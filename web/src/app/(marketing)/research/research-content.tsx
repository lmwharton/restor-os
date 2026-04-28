"use client";

import { useState } from "react";
import {
  CollapsibleDocument,
  MarkdownSection,
} from "./components/collapsible-sections";
import type { Section } from "./components/parse-sections";

export function ResearchContent({
  competitiveSections,
  xactimateContent,
  tpaContent,
  multiTradeContent,
  prototypeSessionsContent,
}: {
  competitiveSections: Section[];
  xactimateContent: string;
  tpaContent: string;
  multiTradeContent: string;
  prototypeSessionsContent: string;
}) {
  const [xactimateOpen, setXactimateOpen] = useState(false);
  const [tpaOpen, setTpaOpen] = useState(false);
  const [multiTradeOpen, setMultiTradeOpen] = useState(false);
  const [prototypeOpen, setPrototypeOpen] = useState(false);

  return (
    <div className="space-y-10">
      {/* Section 1: Competitive Analysis */}
      <section>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-[10px] bg-[#fff3ed] flex items-center justify-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="8" cy="8" r="5.5" stroke="#e85d26" strokeWidth="1.5" />
              <path d="M8 5v3l2 1.5" stroke="#e85d26" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px]">
            Competitive Analysis
          </h2>
        </div>
        <p className="text-[13px] text-[#8a847e] mb-4 pl-0 sm:pl-11">
          Full competitive analysis, market sizing, Brett&apos;s co-founder interview, and product strategy
        </p>
        <CollapsibleDocument sections={competitiveSections} />
      </section>

      {/* Divider */}
      <div className="h-px bg-[#eae6e1]" />

      {/* Section 2: Xactimate Codes */}
      <section>
        <button
          onClick={() => setXactimateOpen(!xactimateOpen)}
          className="w-full text-left flex items-center gap-3 group"
        >
          <div className="w-8 h-8 rounded-[10px] bg-[#edf7f0] flex items-center justify-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                x="3"
                y="2"
                width="10"
                height="12"
                rx="1.5"
                stroke="#2a9d5c"
                strokeWidth="1.5"
              />
              <path
                d="M6 6h4M6 8.5h4M6 11h2"
                stroke="#2a9d5c"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] group-hover:text-[#2a9d5c] transition-colors">
              Xactimate Codes
            </h2>
            <p className="text-[13px] text-[#8a847e] mt-0.5">
              Water damage line item codes, units, and scope ordering reference
            </p>
          </div>
          <span
            className={`text-[10px] text-[#b5b0aa] group-hover:text-[#2a9d5c] transition-all duration-200 ${
              xactimateOpen ? "rotate-90" : ""
            }`}
          >
            &#9654;
          </span>
        </button>
        {xactimateOpen && (
          <div className="mt-4 pl-0 sm:pl-11">
            <MarkdownSection content={xactimateContent} />
          </div>
        )}
      </section>

      {/* Divider */}
      <div className="h-px bg-[#eae6e1]" />

      {/* Section 3: TPA Rules */}
      <section>
        <button
          onClick={() => setTpaOpen(!tpaOpen)}
          className="w-full text-left flex items-center gap-3 group"
        >
          <div className="w-8 h-8 rounded-[10px] bg-[#eef0fc] flex items-center justify-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8 2L3 4.5v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6v-4L8 2Z"
                stroke="#5b6abf"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M6 8l1.5 1.5L10.5 6"
                stroke="#5b6abf"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] group-hover:text-[#5b6abf] transition-colors">
              Insurance &amp; TPA Rules
            </h2>
            <p className="text-[13px] text-[#8a847e] mt-0.5">
              Third-party administrator guidelines, rejection triggers, and
              carrier-specific rules
            </p>
          </div>
          <span
            className={`text-[10px] text-[#b5b0aa] group-hover:text-[#5b6abf] transition-all duration-200 ${
              tpaOpen ? "rotate-90" : ""
            }`}
          >
            &#9654;
          </span>
        </button>
        {tpaOpen && (
          <div className="mt-4 pl-0 sm:pl-11">
            <MarkdownSection content={tpaContent} />
          </div>
        )}
      </section>

      {/* Divider */}
      <div className="h-px bg-[#eae6e1]" />

      {/* Section 4: Multi-Trade Expansion */}
      <section>
        <button
          onClick={() => setMultiTradeOpen(!multiTradeOpen)}
          className="w-full text-left flex items-center gap-3 group"
        >
          <div className="w-8 h-8 rounded-[10px] bg-[#fef3c7] flex items-center justify-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8 2v12M2 8h12"
                stroke="#d97706"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="8" cy="8" r="5.5" stroke="#d97706" strokeWidth="1.5" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] group-hover:text-[#d97706] transition-colors">
              Multi-Trade Expansion
            </h2>
            <p className="text-[13px] text-[#8a847e] mt-0.5">
              Platform expansion vision &mdash; insurance repair, remodeling, plumbing, electrical, HVAC, and the pricing database strategy
            </p>
          </div>
          <span
            className={`text-[10px] text-[#b5b0aa] group-hover:text-[#d97706] transition-all duration-200 ${
              multiTradeOpen ? "rotate-90" : ""
            }`}
          >
            &#9654;
          </span>
        </button>
        {multiTradeOpen && (
          <div className="mt-4 pl-0 sm:pl-11">
            <MarkdownSection content={multiTradeContent} />
          </div>
        )}
      </section>

      {/* Divider */}
      <div className="h-px bg-[#eae6e1]" />

      {/* Section 5: Brett's Prototype Sessions */}
      <section>
        <button
          onClick={() => setPrototypeOpen(!prototypeOpen)}
          className="w-full text-left flex items-center gap-3 group"
        >
          <div className="w-8 h-8 rounded-[10px] bg-[#fce4ec] flex items-center justify-center">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 12l2-4 3 2 3-6"
                stroke="#e91e63"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect
                x="2.5"
                y="2.5"
                width="11"
                height="11"
                rx="2"
                stroke="#e91e63"
                strokeWidth="1.5"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-[20px] font-bold text-[#1a1a1a] tracking-[-0.5px] group-hover:text-[#e91e63] transition-colors">
              Brett&apos;s Product Sessions
            </h2>
            <p className="text-[13px] text-[#8a847e] mt-0.5">
              Market sizing, feature ideas, voice UX findings, sketch tool requirements, and iOS direction
            </p>
          </div>
          <span
            className={`text-[10px] text-[#b5b0aa] group-hover:text-[#e91e63] transition-all duration-200 ${
              prototypeOpen ? "rotate-90" : ""
            }`}
          >
            &#9654;
          </span>
        </button>
        {prototypeOpen && (
          <div className="mt-4 pl-0 sm:pl-11">
            <MarkdownSection content={prototypeSessionsContent} />
          </div>
        )}
      </section>
    </div>
  );
}
