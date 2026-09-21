# 个人主页、名片与用户悬停卡片

> 从 CLAUDE.md 拆出。身份脱敏契约见 auth-access.md。

- **个人主页 = 展示 + 工作台 (2026-09-14, migration `20260914000000_user_profile_card`)** — owner
  decision 「个人主页和我的面板功能重复了，合并一下」 REVERSED the old "Profile vs Dashboard, never
  merge" rule. `/users/[handle]` is now the one page: a public showcase of EVERYTHING the member
  published, plus an owner-only **工作台** tab (`?tab=workspace`, the old dashboard: drafts, all-state
  skills/docs, subscriptions with updates, favourites, pending requests, attended events).
  `/dashboard` is kept ONLY as a login-gated redirect to that tab (PAGE_NAMES pins the route); the
  avatar menu has no 面板 entry any more. Contracts:
  - **Data**: `UserProfile` (1:1, kept off the hot `User` row): `headline`, `aboutMd`, `interests`,
    `links`, `layout`, `pins`, `card`, `cardMedia{Kind,Key}`/`cardPosterKey`/`cardLoopKey` (keys only,
    `@unique`). Every JSON column has ONE sanitizer in the import-free `lib/profile/shared.ts`
    (`parseProfileLayout` / `parseCardConfig` / `sanitizeProfileLinks` (http(s) only) / `sanitizePins`)
    that runs on write AND read; view types in `lib/profile/types.ts`.
  - **板块** = `PROFILE_SECTIONS` (11: skills docs posts topics videos zones events votes feedback
    comments shelf), ordered + hidden via `UserProfile.layout`, edited at 设置 → 隐私 → 主页板块.
    The six `User.showProfile*` booleans are LEGACY and read-only: `layout` NULL ⇒ derive from them
    (the `db push` safety net; the migration backfills rows for members who had turned any off; all
    six off ⇒ everything hidden, including sections added later). Never write those columns again.
  - **Viewer model** is `resolveProfileViewer` (`lib/profile/queries.ts`) and `viewer.allowed` is the
    ONLY list of sections that are ever queried: `LOGIN_ONLY_SECTIONS` (videos/zones/votes — their
    source surfaces are login-walled) never reach anonymous viewers; hidden sections are visible only
    to the owner and `identity` holders (badged 仅自己可见). `?as=visitor` (owner only) re-runs every
    gate with `PREVIEW_VISITOR_ID`, a signed-in member with no memberships. Each section reuses its
    domain's own gate (`DISCOVERABLE_SKILL_WHERE`, `BROWSABLE_DOC_WHERE`, `PUBLIC_READY_DOC` for
    shelf/doc comments (doc comments signed-in only), `SHORTS_PUBLIC`+`PUBLISHED_PUBLIC`,
    `listZoneFeed({authorId})` = readable zones + post visibility incl. co-authors,
    `listEventsByAuthor`/`toPublicEvent`, `listVoteActivitiesByCreator`) — never re-derive one here.
    Hero figures and card stats count only sections the viewer may see.
  - **精选 pins** (≤6, `POST /api/me/profile/pins`): pinning checks ownership + the item's public gate;
    rendering re-gates per viewer and silently drops dead pins; the write path prunes dead pins when
    the list is full and the owner sees a 「N 个精选已失效 · 清理」 affordance (`{prune:true}`).
  - **工作台** data (`lib/profile/workspace.ts`) reads only the owner's own rows and `WorkspaceTab`
    re-checks the session itself; `loadWorkspaceAttentionCount` feeds the tab badge and must agree
    with the 待处理 panel.
- **名片 ProfileCard + 悬停卡片 (2026-09-14)** — `components/profile-card/**` is THE card, three styles
  from `CardConfig.style`: `holo` (React Bits `<ProfileCard/>` port: tilt engine writing CSS vars,
  pattern-masked holographic shine, glass bar), `reflective` (React Bits `<ReflectiveCard/>`: member
  photo/loop under frosted metal, per-instance SVG filter id, never a webcam), `minimal` (site-themed
  surface). All CSS is scoped under `.pc-root` in `profile-card.css`; the idle shine runs only for an
  interactive card in the viewport; tilt is gated on fine pointer + reduced motion + `card.tilt`.
  Colour comes only from `cardPalette(theme)` (numbers → rgba, no stored string reaches CSS) — the card
  is the member's MATERIAL, so colour is allowed there (配色契约), chrome around it stays ink.
  - **Hover card**: `UserHoverCard` renders `<ProfileCard size="sm">` from
    `GET /api/users/[handle]/card` (built by `loadProfileCardView`, the ONE builder shared with the
    profile hero and the editor preview). The card module is LAZY-loaded on first hover intent so its
    JS/CSS stay out of the root layout bundle; signed-out viewers get no hover at all (session
    context); `components/user/card-cache.ts` caches only 200/404 for 60 s per viewer — call
    `invalidateUserCard(handle)` after any save that changes a card. Portal at `z-[105]` (above the
    z-[100] lightbox/drawers, below z-[115] badge popovers and the z-[120] toaster); clicks inside it
    stop propagation (an avatar often sits inside a whole-card `<Link>`); keyboard focus on the
    nearest `/users/<handle>` link opens it and Tab walks into it. The Avatar `handle` rule above still
    applies — names are not wrapped yet (copy says 头像).
  - **Card media** (`lib/profile/card-media-storage.ts`, root `uploads/profile-card/` so the existing
    `/_uploads/` X-Accel location covers it): upload `POST /api/profile/media/upload` → attach
    `PUT /api/me/profile/media`. Every key id carries an HMAC owner tag (`ownerTagFor(userId)`) and
    attach rejects keys not minted for the caller. The PUBLIC route `/api/profile/media/[...key]`
    serves a key only while an ACTIVE user's profile references it in the matching column, has an
    explicit HEAD that never opens the file (Next maps HEAD→GET and never drains the body — an fd
    leak), opens GET bodies lazily, and **404s every `video/` key: a video's original (full length,
    audio, location atoms) is never public** — cards show the server poster and play a muted clip
    (`-an -map_metadata -1`) the MEMBER cut; no clip ⇒ poster only. Photos are metadata-stripped
    twice: canvas re-encode in the browser (`app/settings/_components/strip-image.ts`, also avatar and
    banner) and a container-level strip on the server keeping only EXIF Orientation — which is why
    card uploads refuse AVIF (the server cannot strip it). The generic public `/api/uploads/[...key]`
    404s the `profile-card/` namespace (`isPublicUploadKey`) so it can never bypass the gate, and both
    routes share the lazy-body helper `openLazyFileBody`. Uploads that are never attached are swept
    best-effort (owner-tagged, > 24 h, unreferenced) from the upload/delete routes.
  - **视频截取 (2026-09-15, migration `20260915000000_profile_card_clip`)** — owner ask 「截取 30 秒，不足
    30 秒的自动循环播放；网站上加视频截取，最好可以复用」. A video upload now only stores + probes the
    original (≤ 200 MB, `PROFILE_VIDEO_MAX_BYTES`); the member picks ≤ `PROFILE_CLIP_MAX_SECONDS` (30)
    in the browser and `POST /api/me/profile/media/clip {videoKey,start,end,cover}` renders the clip +
    poster in ONE media-queue slot, attaches both and stores `UserProfile.cardMediaClip`
    `{start,end,cover,duration}` (cleared by any other attach / DELETE). A shorter source is used
    whole and simply loops (`<video loop>`). `GET|HEAD /api/me/profile/media/source?key=` streams the
    original to its OWNER only (owner tag + on disk; everyone else 404) so 剪辑片段 can re-cut; the
    original stays on disk for that. No ffmpeg ⇒ 501 and the editor falls back to a client-captured
    poster. **The reusable pieces — use them for any future trim/clip surface, never fork them:**
    `lib/media/clip-shared.ts` (pure range math both sides MUST share: `normalizeClipRange`,
    `normalizeCover`, `resizeClipRange`, `roundClipTime` …), `lib/media/ffmpeg.ts` (server runner +
    `probeMediaFile`, no `@/lib/env`) and `lib/media/video-clip.ts` (pure `buildClipArgs` /
    `buildFrameArgs` + tmp-then-rename `renderClip` / `renderFrame`, absolute paths in), and on the
    client `components/media/VideoTrimmer.tsx` (controlled, no network) + `VideoTrimDialog.tsx` +
    `filmstrip.ts`. ffmpeg picks a demuxer from file CONTENT, so every input we build carries a
    format whitelist and uploads must look like ISO-BMFF / EBML — an `ffconcat` text file posing as
    `.mov` otherwise renders someone else's private original into a public clip.
    One clip render per member at a time (409 `clip_in_progress` + retry-after), encoder threads
    capped, output fps clamped to [1, 30], and ranges clamp to the PICTURE length (a file whose audio
    outlasts its video reports the longer track to the browser — the trimmer takes `maxDuration`).
    The source route caches `private, max-age=600` + `Vary: Cookie` so the preview and filmstrip
    share bytes. A new upload whose clip fails (501 / 500) degrades to a client-captured poster; a
    re-trim never swaps a working clip for a still.
  - **Badges**: `ProfileBadge` = honorific role (`publicRoleBadge`, now with description) + visible
    `UserTag`s (`icon` from `BADGE_ICONS`, description, granted date). `BadgeChip` opens a portaled
    detail popover on hover/focus/tap; its Esc is captured so it closes only itself. Anonymous viewers
    never trigger the 版主 reconcile write and never see login-walled auto badges.
  - **Editors**: 设置 → 个人资料 (headline, 签名, 关于我, interests, links, banner), 设置 → **名片**
    (`/settings/card`: media, style, theme, text, toggles, effects; live preview renders the owner view
    in 名片 mode and the `PREVIEW_VISITOR_ID` view in 悬停时 mode so a 隐私账号 previews what others
    really see; touch devices reframe only with the 调整取景 toggle on), 设置 → 隐私 → 主页板块,
    设置 → 我的标签. Admin tag icons/descriptions at `/manage/user-tags`.
- **用户卡片 (hover card)**: `components/user/UserHoverCard.tsx` — hover any person and their
  customizable 名片 (see 「名片 ProfileCard + 悬停卡片」 below) fades in from
  `GET /api/users/[handle]/card`. It is wired app-wide through `Avatar`: **pass `handle` to
  `<Avatar/>` and it self-wraps** — that is the one thing to remember when adding a new surface
  that renders another user. Omit `handle` ONLY for the viewer's own avatar (navbar, composers,
  settings) and for non-users (`EventSpeaker` rows are free text). Three invariants, each of
  which was a real bug: the popover is **portaled to body** (an ancestor `opacity` renders it
  translucent with the page bleeding through; an ancestor `transform` re-parents its `fixed`
  box — same trap as `DeptTag`'s tooltip and `ImageLightbox`); nesting is **self-suppressing**
  via context, so a call site may still wrap an avatar+name cluster in `<UserHoverCard>` to make
  the NAME hoverable without stacking two cards on the avatar inside; and a null/401 fetch
  **closes** rather than leaving a skeleton (the endpoint needs a session; signed-out viewers now
  get no hover at all). One fetch per handle per viewer (60 s cache) on 150 ms hover intent.
  标签 (`UserTag`/`UserTagAssignment`): admin-assigned in bulk or singly at `/manage/user-tags`,
  auto-granted ones (版主) synced by `lib/user-tags.ts`, and the user picks which to display at
  `/settings/tags`.
