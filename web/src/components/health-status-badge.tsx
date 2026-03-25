"use client";

import { useState } from "react";
import { useHealthStatus } from "@/lib/hooks/use-health-status";

const DOT_COLORS: Record<string, string> = {
  healthy: "bg-green-500",
  degraded: "bg-amber-500",
  unhealthy: "bg-red-500",
  loading: "bg-outline animate-pulse",
  unreachable: "bg-red-400",
};

const TEXT_COLORS: Record<string, string> = {
  healthy: "text-green-700",
  degraded: "text-amber-700",
  unhealthy: "text-red-700",
  loading: "text-outline",
  unreachable: "text-red-600",
};

export function HealthStatusBadge() {
  const { status, text, services } = useHealthStatus();
  const [showTooltip, setShowTooltip] = useState(false);

  const dotColor = DOT_COLORS[status] ?? DOT_COLORS.loading;
  const textColor = TEXT_COLORS[status] ?? TEXT_COLORS.loading;

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-outline-variant/20 bg-surface-container-low/50 cursor-default">
        <span className={`w-1 h-1 rounded-full ${dotColor} shrink-0`} />
        <span
          className={`text-[9px] font-[family-name:var(--font-geist-mono)] uppercase tracking-[0.04em] ${textColor} hidden sm:inline`}
        >
          {text}
        </span>
      </div>

      {/* Tooltip */}
      {showTooltip && Object.keys(services).length > 0 && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-surface-container-lowest rounded-lg shadow-[0_4px_16px_rgba(31,27,23,0.12)] border border-outline-variant/20 p-3 z-50">
          <p className="text-[10px] font-[family-name:var(--font-geist-mono)] uppercase tracking-wider text-on-surface-variant mb-2">
            Service Status
          </p>
          {Object.entries(services).map(([name, svc]) => (
            <div
              key={name}
              className="flex items-center justify-between py-1"
            >
              <span className="text-[12px] text-on-surface capitalize">
                {name}
              </span>
              <span
                className={`text-[11px] font-[family-name:var(--font-geist-mono)] ${
                  svc.status === "ok" || svc.status === "connected"
                    ? "text-green-600"
                    : "text-red-500"
                }`}
              >
                {svc.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
