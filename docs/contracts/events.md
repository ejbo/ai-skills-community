# 活动 (Events, /events)

> 从 CLAUDE.md 拆出。面向用户的能力清单另见 ../events-capabilities.md。

- **活动 (Events)**: Luma-style community event calendar at `/events` (`Event`/`EventSpeaker`;
  migration `20260730120000_add_events`). **面向用户的能力清单已经核实过一遍并写进
  `docs/events-capabilities.md`（发布/浏览/报名/提醒/时区/权限/站内入口 + 「别说什么」+
  「没有的能力」）—— 做胶片、写文档、答疑直接取用，不要再开调研去重读一遍这些文件。** 大类 = `EventKind` enum (external/internal/
  expert_talk/seminar), 小类 = `topics String[]` from the fixed `EVENT_TOPICS` taxonomy in
  `lib/events/types.ts` — two orthogonal facets, don't merge them. 城市 and 时区 are ALSO fixed
  option sets there (`EVENT_CITIES`; `EVENT_TIMEZONES` = 东部/中部/西部/北京 as IANA zones).
  **Time model**: timed events store REAL UTC instants + the organizer's IANA `timezone`
  (`zonedWallToUtc` in `lib/events/time.ts`, Intl-based, no tz dep); the UI converts to each
  viewer's browser zone via the `EventTime*` client leaves (SSR deterministically renders the
  event's own zone, a post-hydration effect swaps in the viewer zone — no mismatch). ALL-DAY
  events are date-only (UTC midnight, `timezone` null) and never converted; legacy null-zone
  timed rows count as the default zone. Because the zone set is CLOSED, date filters compile to
  exact per-zone SQL branches (`rangeWhere`/`upcomingWhere` in `lib/event-queries.ts`) — 即将举行
  keeps an event until its last day ends in its OWN zone. List grouping/calendar dots key on
  `eventLocalDayKey` (event-own-zone date); multi-day events dot every grid day (window-clamped
  expansion) but appear ONCE in the list; a day filter collapses the list under the SELECTED
  day header. `meetingUrl` is member-only — trimmed server-side in `toPublicEvent` for anonymous
  viewers and left out of the .ics. Permissions: content edits author-only (the PATCH route
  branches on `title` in the body); `pinned` admin-only (cap `MAX_PINNED_EVENTS` enforced on
  pin; strip dedupes against the timeline); `cancelled` author-or-admin (stays visible, badge +
  【已取消】calendar-title prefix); DELETE is soft (`deletedAt`) — any new Event read must filter
  `deletedAt: null` (lib/search.ts does too). Speakers are replaced wholesale on edit (delete +
  create in one transaction; detail page renders them as square-avatar profile cards).
  添加到日历 = UTC(`Z`) Google link built client-side (needs window.origin) + `/api/events/[id]/ics`
  — all-day DTEND is EXCLUSIVE (+1 day) and the download filename stays ASCII-only.
  **我要参加 / 提醒 (migration `20260807000000_add_event_attendees`)**: `EventAttendee`
  (composite PK) + denormalized `Event.attendeeCount` via guarded array transactions
  (like-route pattern — races fall through to the authoritative re-read). Toggle =
  `POST /api/events/[id]/attend`; join is gated (no cancelled/finished events) but LEAVE always
  works, and the detail-page card stays visible to an attending viewer after 取消/结束 so
  「我参加的」can be cleaned up. `?mine=1` is a FACET (`EventFilters.mineFor`, viewer id only —
  never client input) composing with tabs/calendar/counts; ignored for anonymous. Attending
  cards get an accent border + 已参加 badge. **Reminders**: joining IS the opt-in (deliberately
  NOT gated by `NotificationPreference`); `lib/events/reminders.ts` sweeps timed, live events
  starting within ~35 min and notifies un-reminded attendees (in-app `event_reminder` + email),
  claiming rows ATOMICALLY via `updateMany(remindedAt: null → now)` so concurrent sweeps never
  double-send. Trigger paths: throttled piggyback on `GET /api/notifications` (the bell polls it
  while anyone is online) + `scripts/send-event-reminders.ts` for real cron (`*/5 * * * *`) —
  keep both. All-day events are skipped (no meaningful "30 min before").
  **Card UX (migration `20260807120000_add_event_cover_pos`)**: list cards carry a compact
  `CardAttendButton` (rendered whenever the event is joinable — anonymous clicks get the house
  401 toast + login redirect, so the server card needs no session). Covers open in
  `ImageLightbox` — it MUST portal to `<body>` (`card-hover`'s hover transform creates a
  containing block that traps `fixed` overlays). Detail cover: `Event.coverPos` null ⇒ full
  image shown blur-contain INSIDE the 2:1 frame (nothing truncated); set ⇒ object-cover with
  that CSS object-position — the uploader picks it by dragging in `CoverEditor` (2:1 取景框,
  pointer-capture drag, '' = 完整显示; a crop without a cover is never stored). Detail page
  section order: 讲师/嘉宾 ABOVE 活动介绍; right rail ends with 相关活动
  (`listRelatedEvents`: upcoming + live, same kind OR overlapping topics, ≤4).
