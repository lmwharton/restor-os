"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api";

interface NotificationItem {
  id: string;
  event_type: string;
  user_id: string | null;
  user_name: string | null;
  is_ai: boolean;
  job_id: string | null;
  job_number: string | null;
  event_data: Record<string, unknown>;
  created_at: string;
  is_unread: boolean;
}

interface NotificationsResponse {
  unread_count: number;
  items: NotificationItem[];
}

interface UnreadCountResponse {
  unread_count: number;
}

const POLL_INTERVAL = 60_000; // 60 seconds

export function useUnreadCount() {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const data = await apiGet<UnreadCountResponse>("/v1/notifications/unread-count");
      setCount(data.unread_count);
    } catch {
      // Silently fail — don't break the UI for a badge
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, POLL_INTERVAL);

    // Also refetch when tab becomes visible
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchCount();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchCount]);

  return { count, refetch: fetchCount };
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiGet<NotificationsResponse>("/v1/notifications?limit=20");
      setNotifications(data.items);
      setUnreadCount(data.unread_count);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markSeen = useCallback(async () => {
    try {
      await apiPost("/v1/notifications/mark-seen");
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, is_unread: false }))
      );
    } catch {
      // Silently fail
    }
  }, []);

  return { notifications, unreadCount, isLoading, fetchNotifications, markSeen };
}

export type { NotificationItem };
