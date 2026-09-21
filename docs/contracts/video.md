# 视频与随刷短视频 (Videos, Shorts)

> 从 CLAUDE.md 拆出。shorts 骑在 Video 模型上，每个 Video 查询都要显式决定是否含 shorts。

- **随刷短视频 (Shorts, migration `20260811000000_add_short_videos`)**: TikTok-style vertical
  swipe feed riding the EXISTING Video board — shorts are `Video` rows with `isShort: true`
  (member `sourceType: user_uploaded`, published-public on create), reusing VideoLike/VideoFavorite/
  VideoComment (+CommentSection in a drawer)/VideoView and the videos file route. **Every Video
  read must now decide about `isShort`**: `PUBLISHED_PUBLIC` (lib/video/queries.ts), lib/search.ts,
  /manage/videos (+its edit page and the admin PATCH/DELETE `/api/videos/[slug]`, which 404 shorts —
  their DELETE hard-unlinks files, shorts soft-delete keeps them) all filter it; `favoriteVideos`
  deliberately does NOT (稍后看 is the only favorites surface; short cards deep-link fine because
  `/videos/[slug]` redirects shorts → `/videos/shorts?v=<id>&focus=…`, which keeps comment
  notifications working). Feed `/videos/shorts` (app/videos/shorts/): scroll-snap `y mandatory` +
  `scroll-snap-stop: always`, ONE IntersectionObserver max-ratio active detection, real `<video>`
  only at active ±2 (decoder windowing is correctness, not perf), muted-first autoplay with
  persisted unmute (`localStorage shorts:sound`) + play()-rejection tap-to-play fallback, keyset
  `createdAt|id` / hot `o:<n>` cursors (lib/video/shorts-queries.ts). Member upload =
  `/api/shorts/upload` (raw-body protocol; **NO limits by product decision** — no size cap, no
  duration cap, no daily byte budget, no per-day publish cap; only a 30/min burst limiter. Do NOT
  reintroduce caps. `sizeBytes` clamps at int32 max; faststart remux, skipped >2GB as a perf guard);
  publish = POST `/api/shorts` re-validating echoed keys (shape + on-disk + not-attached-elsewhere);
  ffprobe only CORRECTS durationSec metadata (client value is the fallback). Views count ONLY via the
  deduped `/api/shorts/[id]/view` (VideoView sessionHash; the long-video +1-per-open ping 404s
  shorts — viewCount ranks the hot feed). AI 文案润色 lives in `lib/video/shorts-caption.ts`,
  SERVER-ONLY (its extractJsonObject chain reaches yauzl/node:crypto — client components import
  only the import-free `lib/video/shorts-shared.ts`). 精选 (admin `featured`, /manage/shorts or
  PATCH `/api/shorts/[id]`) feeds every embed surface (`featuredShorts`: featured first, hot
  backfill). i18n namespace `shorts`.
  **ONE player code path**: `ShortsCell` (app/videos/shorts/_components/) is THE short player —
  rail (赞/评论/收藏/分享/字幕/静音), caption + uploader + date, drag-seek, double-tap like, view
  ping. `ShortsShowcase` (app/_components/home/) is a chrome-only wrapper (slide transitions,
  wheel/touch/chevrons/dots/counter/fullscreen, play-only-in-viewport) — NEVER fork a second
  player; embeds pass `embed` + `onEnded` and route comments to `/videos/shorts?v=<id>&comments=1`
  (drawer auto-opens; `?upload=1` auto-opens the upload dialog — the visible entry points).
  Surfaces: homepage hero band v3 (left: welcome→今日简报→热门Skills 2×2; right: full-height
  showcase), GeekHub `/videos?tab=shorts` (Douyin-style: showcase hero + side cards + vertical
  card grid), and the immersive feed. RSC boundaries build items via
  `annotateShortsViewer`+`toShortView` (lib/video/shorts-queries.ts) — never hand-map.
  **字幕 (subtitles)**: `lib/video/subtitles.ts` — best-effort local ASR + translation, fired on
  publish and via POST `/api/shorts/[id]/subtitles` (author/admin). ffmpeg extracts 16k wav →
  a LOCAL whisper binary transcribes to VTT — ZERO-CONFIG discovery for pull-only servers:
  binary = `WHISPER_BIN` override, else `whisper-cli` on PATH → `~/whisper.cpp/build/bin/whisper-cli`
  (systemd PATH lacks user builds) → `whisper` (openai-whisper, model NAME via WHISPER_MODEL);
  ggml model = `WHISPER_MODEL` override, else best `ggml-*.bin` in `~/models/` or
  `<LOCAL_STORAGE_DIR>/models/` (large-v3-turbo → … → tiny) → house LLM
  (getLibraryProvider) translates cues 中↔EN (unavailable ⇒ original track only, noted in
  `subtitleError`). Tracks stored as `subtitle/<nanoid>.vtt` in the videos storage (file route
  serves text/vtt), columns `subtitleStatus/SrcLang/ZhKey/ZhUrl/EnKey/EnUrl/Error/At`
  (migration `20260813000000_add_short_subtitles`); pure VTT helpers in
  `lib/video/subtitles-shared.ts` (unit-testable, no env). **Cues are rendered by US, not the
  browser**: tracks run in `hidden` mode (cuechange still fires) and the active cue is drawn as an
  overlay INSIDE the visible frame just above the caption — native `::cue` paints at the bottom of
  the video ELEMENT (its letterbox), which on a tall cell lands at the page bottom. Selector
  cycles 关→中→EN, persisted `shorts:subtitle`.
  **内容来源** (migration `20260813150000_add_short_origin`): `originType original|repost` +
  `sourceUrl/sourceAuthor` — 搬运 REQUIRES both (server 400 `source_required`); shown in the cell
  meta + the 详情 panel. **Feed desktop layout is 抖音-style**: left swipe feed + right
  `ShortsSidePanel` (详情 | 评论 | TA 的作品 tabs, follows the active item; comments = the same
  CommentSection; works = `ShortsAuthorWorks`, fed by `GET /api/shorts?uploader=<handle>`). ALL
  shorts overlays (评论 sheet/panel, TA 的作品) ride the shared `HostPanel` shell: **transparent
  click-catcher, NO scrim** (a black/40 scrim grayed the video — user rejected it), sliding from
  INSIDE the player container; hosts wrap conditional renders in `<AnimatePresence>` for the exit
  slide. **Embedded players (ShortsShowcase) go further: the panel is INLINE** — root is a flex
  row, the panel animates width 0%→62% (max 400px) and the video region RESIZES to make room
  (covering the video was rejected); the widget's wheel handler must ignore events inside
  `[data-shorts-panel]` or the comment list can't scroll. Embed fullscreen adds
  `h-[100dvh] w-screen` when active (Tailwind's fixed-height class otherwise beats the UA
  :fullscreen sizing and the video stays small). 评论 composer (`CommentComposer`, shared with the
  long-video detail page) is 抖音-lightweight BY DEFAULT: auto-growing textarea pill (Enter 发送)
  + 图片/表情包 buttons appending markdown + a small round icon send button; the full
  RichTextEditor sits behind an explicit 富文本 toggle — do not make rich the default again.
  Comment likes already exist (`VideoCommentLike` + ♡ in CommentItem). Avatar click opens TA 的作品 (NOT the profile — profile link lives in the panel header);
  subtitle cue renders INSIDE the caption gradient container above the text block so it rides up
  with the caption and can never overlap it. Embed fullscreen is a TOGGLE tracked via
  `fullscreenchange` (wheel/touch listeners live on the fullscreened element, so 上下刷 works in
  fullscreen; ↑/↓/M added while fullscreen). Nav renames:
  Skills Center→Skills, Geek Hub→Videos. **`/videos` DEFAULTS to Geek Videos** (2026-08-26 — the
  section is named after the long-form board, so that is what a visitor lands on); Shorts is the
  second tab at `?tab=shorts`, and the immersive feed stays at `/videos/shorts` (its back arrow
  returns to `?tab=shorts`). Bare `/videos` therefore carries NO `tab` param — pagination and
  breadcrumbs must not add one. The switcher keeps `mb-6` above the billboard; without it the two
  read as one welded block. Shorts CTAs are NEUTRAL (zinc/white
  solids) — the user explicitly rejected accent-blue "AI-looking" buttons; homepage shorts header
  has view-all ONLY (no upload button).
- **Video delivery**: the file route (`app/api/videos/file/[...key]`) streams from local disk with
  HTTP Range. Under concurrency the bottleneck is that bytes flow through Node — set
  `VIDEO_X_ACCEL_REDIRECT=true` + add the internal `/_video/` nginx location (see deploy conf)
  to offload byte-serving to nginx `sendfile` (Node only does `auth()` then returns the header).
  Card/hero hover previews use ONLY the dedicated short `preview` clip (never the full source) —
  don't reintroduce a `?? videoUrl` fallback. (The 投票活动 gallery has a deliberately gated
  exception — see 作品卡片 = Geek Videos 卡片 above — and unlike this board it GENERATES its clips
  server-side; `Video.previewKey` here is still a second file an admin uploads by hand.) Not yet done (needs ffmpeg on the box): `+faststart`
  remux on upload (fixes tail-`moov` first-frame delay) and HLS/adaptive transcoding.

## 长视频：字幕、播放器、AI 背景、上传、封面与横幅 (2026-09-18, migration `20260918000000_video_subtitles_covers`)

Owner:「给上传的长视频也加中英文字幕，跟短视频一样；用户能调字幕的位置、大小、背景；字幕作为 AI 的背景，
结合作者上传的视频描述做摘要和问答；上传选项复用名片的视频剪辑和投票的封面裁剪；封面支持竖版；
feature 视频在 banner 里边角被截断」。

- **字幕管线不再只认短视频.** `lib/video/subtitles.ts#generateVideoSubtitles` (`generateShortSubtitles` is the
  same function, kept for the shorts routes) — the claim and the stale sweep no longer filter `isShort`.
  Long-video triggers: POST `/api/videos` when `status: published` with a stored source (`autoSubtitles:false`
  opts out), PATCH on the draft→published transition when there are no tracks, PATCH when a published
  video's SOURCE was replaced, and the explicit 重新生成 button (`POST /api/videos/[slug]/subtitles`, `videos`).
  Drafts never trigger it — an ASR run is real CPU and a draft's source is often replaced.
  - whisper's timeout scales with the video (`whisperTimeoutMs`: 4× real time, floor 90 min, ceiling 12 h —
    a fixed 90 min killed every talk over ~1 h on the capped thread pool); `WHISPER_THREADS` (default 2).
    The `subtitleAt` lease is what makes hours-long jobs safe — do not replace it with a bigger sweep cutoff.
  - Queue: shorts that are still WAITING are picked ahead of long videos (`takeNextJob`); a running job is
    never pre-empted. One long talk must not make every short published after it wait for hours.
  - **Translation is retry → split → per-cue fallback** (`lib/video/subtitle-translate.ts`, pure, tested with a
    fake model). The old loop returned null for the WHOLE track on one merged line — across the ~60
    sequential calls of a long video that was nearly always. Two breakers: 3 consecutive request FAILURES
    abort (a down model must not cost thousands of doomed calls), and > 30 % of cues falling back to the
    original ⇒ no track (a mostly-untranslated "English" track is worse than none). Replies go through
    `stripReasoning` — a `<think>` block that quotes numbered lines used to pollute the result.
  - **Tracks can be uploaded** — `PUT /api/videos/[slug]/subtitles?lang=zh|en[&translate=1]`, raw VTT/SRT
    body ≤ 2 MB, `DELETE ?lang=`. `parseSubtitleFile` tells VTT from SRT by CONTENT, strips cue markup and
    ALWAYS re-serialises: a stored track is timestamps + plain text lines, never the uploaded bytes (the
    file route serves it as `text/vtt` on our origin). UTF-8 (fatal) → BOM'd UTF-16 → GB18030 decode.
    `Video.subtitleManual` records that a person touched the tracks: **a replaced source never regenerates
    over manual tracks** (a re-encode of the same talk is the common reason to replace a source, and
    silently redoing someone's proofreading is worse than leaving it) — only 重新生成 does. Replaced /
    removed track FILES are unlinked (one referent: the row), unlike a short's media.
  - `pnpm videos:backfill-subtitles` (dry run; `--apply`, `--limit N`) for videos published before this.
- **字幕 → AI 背景.** On success the SOURCE-language (verbatim ASR) track is merged into timestamped
  paragraphs — `lib/video/transcript.ts`: a new paragraph on a ≥ 2.5 s pause / 45 s / 420 chars, consecutive
  identical cues collapsed (whisper loops "谢谢观看" on silence) — and stored in `Video.subtitleTranscript`.
  Never the translation: translating a mis-hearing compounds it instead of letting the model fix it.
  `lib/video/ai.ts`: the manual `transcriptText` wins, else `subtitleTranscript` (`effectiveTranscript`);
  context order is fixed TITLE → DURATION → TAGS → SPEAKER (嘉宾, new) → DESCRIPTION → TRANSCRIPT and **only
  the transcript is ever truncated**, at a paragraph boundary (`VIDEO_AI_CONTEXT_CHARS`, default 120 K — lower
  it for a small-context intranet model). The pipeline then calls `refreshVideoSummaryIfStale` (source-hash
  compare; never throws) so the summary becomes about what was SAID. With a stamped transcript the summary
  gets a 时间线 section and the chat is told to cite `[m:ss]`; `lib/video/timestamps.ts#linkifyStamps` turns
  those into `#t=<seconds>` links and `player/SeekLinks.tsx` (ONE delegated click) seeks the player — a
  fragment href needs no sanitizer exception. **No `maxTokens` on the summary** (it was 700, spent inside
  `<think>` by the intranet's reasoning models) and the reply goes through `stripReasoning`.
  - **The chat and summary routes are gated by `canViewVideo`**, like the page. They used to check only
    "logged in + slug exists", which — now that the context is everything said in the video — would let
    anyone read a draft or private video back out of the assistant.
  - `getVideoBySlug` selects every scalar EXCEPT the two transcripts (`VIDEO_DETAIL_SELECT`, built from
    `Prisma.VideoScalarFieldEnum`); only the AI routes read them (`VIDEO_AI_SELECT` in `lib/video/summary.ts`).
- **播放器 = `components/video/VideoPlayer.tsx`, custom controls on purpose.** Cues are drawn by US
  (`player/SubtitleOverlay.tsx`; the rule the shorts player already follows) so the viewer can move /
  restyle them and show 中 + EN at once — and with native `controls` the fullscreen button fullscreens the
  `<video>` ELEMENT, where our overlay does not exist. So the FRAME goes fullscreen and owns its bar.
  - Cues are fetched + parsed VTT (`player/useSubtitleCues.ts`, module cache by URL — a regenerated track has
    a new nanoid URL), the active cue resolved per animation frame while playing (`timeupdate` is ~4 Hz).
    `<track>` elements exist ONLY for the places the overlay cannot reach (iPhone native fullscreen,
    Picture-in-Picture): `disabled` — never fetched — until one of those modes starts.
  - **The `<video>` is server-rendered, so `loadedmetadata` / `error` routinely fire BEFORE hydration** and an
    event nobody heard never comes back: the mount effect catches up from `readyState` / `el.error`. Without
    it `?t=` and resume silently did nothing on a fast connection. Keep that effect.
  - Viewer preferences are per BROWSER (`lib/video/subtitle-style.ts`, pure): mode `off|zh|en|both`
    (`video:subtitle`) + style `{scale, x, y, bgOpacity, color, outline, bold}` (`video:subtitle-style`), every
    read through `parseSubtitleStyle` (closed sets + clamps — it reaches a style attribute). Geometry is % of
    the FRAME (x = block centre, y = bottom edge above the frame's bottom), so one value works inline, in
    fullscreen and on a phone; the font derives from the frame's width. The block is clamped in PIXELS
    against its measured size, lifted above the control bar while it shows (`liftPx`), and steps aside while
    the settings popover is open (`rightInsetPx`) — the viewer is restyling those very lines. Neither is a
    stored change. Dragging the text moves it (4 px slop, snaps to centre).
  - Settings = `player/SubtitleSettings.tsx`: an in-frame popover, or a bottom SHEET portaled to
    `usePortalHost()` when the frame is shorter than 420 px (a phone) — opaque there (it lies over the page),
    translucent over video. Dark whatever the site theme is. The popover must fit a ~470 px frame without
    scrolling (背景 | 文字颜色 share a row for that).
  - `player/watch-bus.ts` is a module-level channel (seek requests in, 4 Hz progress out): the player and the AI
    panel live in different subtrees of an RSC page. 文稿 tab = `AiTranscript.tsx` (paragraphs, search, 中/EN,
    follows playback inside its OWN scroller — `scrollIntoView` would move the page).
  - Also: keyboard (Space/K, ←→, J/L, ↑↓, M, F, C, </>, 0–9), `?t=<sec>`, per-browser resume with a 从头播放
    chip, polling `GET …/subtitles` while a job runs, a blurred-poster backdrop behind a contained video
    (portrait videos are letterboxed by their own colours).
- **长视频上传 reuses, never forks.** `VideoCoverClipField` = `VideoTrimDialog` (the 名片 trimmer) to pick a ≤ 20 s
  hover preview AND the cover frame in one gesture → `POST /api/videos/clip` (`videos`) →
  `lib/video/preview-clip.ts` → the shared `lib/media/video-clip.ts` renderers, one media-queue slot: a muted
  ≤ 960 px clip + a ≤ 1920 px poster. The range is re-normalised server-side with `normalizeClipRange`
  (what the handles showed is what is cut; a crafted body cannot exceed the cap). Only `source/<nanoid>.<ext>`
  keys, on disk, that sniff as a real container. Nothing is attached by the route — the form echoes keys on
  save; `Video.previewClip` stores `{start,end,cover,duration}` so the trimmer reopens there. 501 without
  ffmpeg ⇒ the two manual upload buttons are the way through. PATCH unlinks files a save orphaned (only when
  no other row names the key). The source upload now answers with ffprobe's duration / display size.
- **封面契约 = `lib/media/cover-pos.ts` (shared with 投票 + 技术专区帖子).** `posterAspect landscape|portrait` +
  three-state `posterPos` (`''` centre crop / `'contain'` whole image on a blurred copy / `'x% y%'`). TEXT
  columns, closed set in CODE. `pos` reaches a style attribute: reject on write (`parseCoverPos` → 400), ignore
  on read (`coverPosOf`). Rendered ONLY through `components/media/CoverImage.tsx`: `slot="landscape"` keeps a
  uniform 16:9 card slot and stands a PORTRAIT cover inside it as a centred 3:4 frame on its own blur;
  `slot="adaptive"` is for callers that shaped the slot themselves (billboard artwork). A freshly picked TALL
  image starts as 竖版 + 完整显示 (`defaultCoverFor`) — the failure this exists to prevent is a 海报 whose title
  was cut off by a centre crop. Editor = `components/media/CoverCropEditor.tsx` / `CoverCropDialog.tsx`
  (extracted from 投票's PosterCropEditor, which is now a thin wrapper — do not grow a second copy).
  Embed cards / profile pins still centre-crop their small thumbs (not worth a framed poster at 56 px).
- **首页横幅 (`HomeHero`) never crops the cover.** The banner is ~3:1 and covers are 16:9, so `object-cover`
  cut ~40 % of every cover's height (「边角被截断」). Now: an AMBIENT layer (the poster, blurred + dimmed, fills
  the banner — the band's colour comes from the material) + the ARTWORK in its own frame
  (`videoCoverRatio(posterAspect)`), pinned right at full banner height; landscape feathers into the ambient
  layer (CSS mask), portrait stands as a floating poster card; phones stack (artwork on top, text below).
  **The scaled-up blur must be clipped by its OWN box** (`overflow-hidden` on the ambient wrapper, plus
  `overflow: clip` on the section): otherwise it is scrollable overflow of an `overflow:hidden` section and a
  `focus()` / `scrollIntoView()` inside the banner shifts the whole band upward. `CoverImage` does the same.

