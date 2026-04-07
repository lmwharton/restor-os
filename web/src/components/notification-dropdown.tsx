"use client";

import { useState, useRef, useEffect } from "react";
import { useNotifications, useUnreadCount } from "@/lib/hooks/use-notifications";
import type { NotificationItem } from "@/lib/hooks/use-notifications";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function eventLabel(item: NotificationItem): string {
  const data = item.event_data;
  const name = item.user_name || "System";

  switch (item.event_type) {
    case "photo_uploaded": {
      const count = data.count as number;
      const room = data.room_name as string;
      return `${name} uploaded ${count} photo${count !== 1 ? "s" : ""}${room ? ` — ${room}` : ""}`;
    }
    case "moisture_reading_added": {
      const room = data.room_name as string;
      return `${name} added moisture reading${room ? ` — ${room}` : ""}`;
    }
    case "ai_photo_analysis":
      return "AI completed photo analysis";
    case "ai_sketch_cleanup":
      return "AI sketch cleanup done";
    case "report_generated":
      return "Report generated";
    case "job_status_changed": {
      const to = data.to as string;
      return `Job moved to ${to}`;
    }
    case "job_created":
      return `${name} created a job`;
    case "room_added": {
      const room = data.room_name as string;
      return `${name} added room: ${room}`;
    }
    default:
      return `${name}: ${item.event_type.replace(/_/g, " ")}`;
  }
}

function EventIcon({ item }: { item: NotificationItem }) {
  if (item.is_ai) {
    return (
      <div className="w-8 h-8 rounded-full bg-[#fff0e8] flex items-center justify-center shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e85d26" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center shrink-0 text-[11px] font-semibold text-on-surface-variant uppercase">
      {(item.user_name || "?").charAt(0)}
    </div>
  );
}

export default function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { count, refetch: refetchCount } = useUnreadCount();
  const { notifications, unreadCount, isLoading, fetchNotifications, markSeen } = useNotifications();

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  async function handleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    await fetchNotifications();
    if (count > 0) {
      await markSeen();
      refetchCount();
    }
  }

  const displayCount = open ? unreadCount : count;

  const teamEvents = notifications.filter((n) => !n.is_ai);
  const aiEvents = notifications.filter((n) => n.is_ai);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={handleOpen}
        className="relative p-2 rounded-lg hover:bg-surface-container transition-colors cursor-pointer"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-on-surface-variant">
          <path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {displayCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#dc2626] text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {displayCount > 99 ? "99+" : displayCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-surface-container-lowest rounded-xl shadow-[0_8px_32px_rgba(31,27,23,0.12)] border border-outline-variant/30 overflow-hidden z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-outline-variant/20">
            <h3 className="text-sm font-semibold text-on-surface">Notifications</h3>
          </div>

          {/* Content */}
          <div className="max-h-[400px] overflow-y-auto">
            {isLoading && notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-on-surface-variant">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="mx-auto mb-2 text-outline">
                  <path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="text-sm text-on-surface-variant">No activity yet</p>
                <p className="text-xs text-outline mt-1">Events from your team and AI will show up here</p>
              </div>
            ) : (
              <>
                {/* Team Activity */}
                {teamEvents.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-surface-container/50">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                        Team Activity
                      </span>
                    </div>
                    {teamEvents.map((item) => (
                      <NotificationRow key={item.id} item={item} />
                    ))}
                  </div>
                )}

                {/* AI / System */}
                {aiEvents.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-surface-container/50">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant font-[family-name:var(--font-geist-mono)]">
                        AI &amp; System
                      </span>
                    </div>
                    {aiEvents.map((item) => (
                      <NotificationRow key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({ item }: { item: NotificationItem }) {
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 border-b border-outline-variant/10 last:border-b-0 transition-colors ${
        item.is_unread ? "bg-[#fff8f4]" : ""
      }`}
    >
      <EventIcon item={item} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-on-surface leading-snug">{eventLabel(item)}</p>
        <div className="flex items-center gap-2 mt-1">
          {item.job_number && (
            <span className="text-[11px] font-medium text-primary font-[family-name:var(--font-geist-mono)]">
              {item.job_number}
            </span>
          )}
          <span className="text-[11px] text-outline">{timeAgo(item.created_at)}</span>
        </div>
      </div>
      {item.is_unread && (
        <span className="w-2 h-2 rounded-full bg-[#dc2626] shrink-0 mt-1.5" />
      )}
    </div>
  );
}
