# Spec 05: Notification Center

| Field | Value |
|-------|-------|
| Status | In progress |
| Priority | Medium |
| Depends on | Spec 01 (Jobs + event_history table) |
| Estimate | 1 session |

## Done When

- [ ] `users` table has `last_notifications_seen_at` column (TIMESTAMPTZ)
- [ ] `GET /v1/notifications` returns recent company events with unread count
- [ ] `POST /v1/notifications/mark-seen` updates `last_notifications_seen_at` to now()
- [ ] Bell icon red dot shows only when unread_count > 0
- [ ] Clicking bell opens dropdown with two sections: Team Activity + AI/System
- [ ] Each event shows: who, what, which job, when (relative time)
- [ ] Opening dropdown marks all as seen (red dot disappears)
- [ ] Events since last login get subtle highlight vs events while logged in
- [ ] Works on mobile header bell too

## Schema Change

```sql
ALTER TABLE users ADD COLUMN last_notifications_seen_at TIMESTAMPTZ;
```

No default needed. NULL means "never seen" = all events are unread.

## API

### GET /v1/notifications?limit=20

Returns recent company events + unread count. Uses `event_history` table.

```json
{
  "unread_count": 3,
  "items": [
    {
      "id": "uuid",
      "event_type": "photo_uploaded",
      "user_id": "uuid",
      "user_name": "John Smith",
      "is_ai": false,
      "job_id": "uuid",
      "job_number": "WTR-001",
      "event_data": { "count": 12, "room_name": "Kitchen" },
      "created_at": "2026-04-07T16:00:00Z",
      "is_unread": true
    }
  ]
}
```

### POST /v1/notifications/mark-seen

Sets `last_notifications_seen_at = now()`. Returns `{ "marked_at": "..." }`.

## Event Display

| event_type | Display |
|-----------|---------|
| photo_uploaded | "{name} uploaded {count} photos — {room_name}" |
| moisture_reading_added | "{name} added moisture reading — {room_name}" |
| ai_photo_analysis | "AI completed photo analysis" |
| ai_sketch_cleanup | "AI sketch cleanup done" |
| report_generated | "Report generated" |
| job_status_changed | "Job moved to {to}" |
| job_created | "{name} created job" |
| room_added | "{name} added room: {room_name}" |

## Frontend

- Bell icon in desktop + mobile headers
- Red dot: conditional on `unread_count > 0`
- Dropdown: max-h with scroll, grouped into Team / AI sections
- Poll every 60s for unread count (or when tab becomes visible)
- Opening dropdown fires mark-seen + refetches
