# 配色、导航、首页与 GitHub 热榜

> 从 CLAUDE.md 拆出。配色契约的一句话版本留在 CLAUDE.md，这里是完整版。

- **配色契约 (2026-08-26): ink chrome, colourful content.** ONE rule decides every colour
  question in this app: *the page has no colour of its own; colour belongs to the material.*
  - **Chrome is ink.** Primary buttons, toggles, active tabs/pills, progress bars, focus rings,
    sliders, selection — all `zinc-900` in light / `zinc-100` in dark (`--accent` in
    `app/globals.css` is now a PER-THEME ink token, not indigo, so a focus ring stays visible on
    both grounds). There is **no `accent-*` class left in `app/**` or `components/**`**; the ramp
    survives in `tailwind.config.ts` only as a fallback for stray future code. The indigo
    `bg-accent-500` button was what the user called "ai 风很浓" — do not bring it back, and do not
    invent a new brand hue for buttons. The only saturated pixel the chrome owns is the CARI logo.
  - **Content keeps its real colour.** Book spines (`DocCover` — hashed hue, no grayscale variant,
    the `mono` prop is GONE), GitHub's per-language dot + the gold star (`GithubTrending`), skill
    source/visibility pills (`SourceBadge` blue/emerald/violet, `VisibilityBadge` emerald/amber/
    zinc), the token-cost threshold (`TokenCostBadge` — ink until it is actually expensive), rating
    stars (`StatRow`, amber), forum categories (`app/discussion/_components/badges.tsx`), event
    kinds (`app/events/_components/badges.tsx`), the notification badge (red), video frames, and
    **people** — `Avatar`'s fallback badge is a name-hashed colour from a 12-hue identity palette
    (`identityColor`, exported), which is why the `tone` prop was deleted from the component and
    from ~37 call sites. Greying these out is what the user rejected as "强行弄成了黑白".
  - Taxonomy chips take their class from the board that OWNS the taxonomy (the homepage imports
    `CATEGORY_META`/`KIND_META`) so a category looks the same on the homepage as on the page the
    row links to. Never re-invent a per-domain palette at the call site.
  - The 知识库 reader is the one surface with its own accent: `--reader-accent` /
    `--reader-accent-rgb` in `read/reader.css` (a deep book-blue, lifted for the dark page) drive
    in-article links, blockquote rules, prose selection and citation chips. They follow the READER
    theme, never the site's — a wall of ink is the wrong answer for a reading surface.
  - **投票活动 (`/votes`) is the second such surface** (2026-09-02, owner decision 「投票这里主要是
    黑白色，不太符合投票的这个风格」). Its palette is `app/votes/_components/vote-theme.ts` — the
    ONLY place a vote colour is defined — and there the colour is SEMANTIC, one state per card, not
    decoration: 玫红 rose = 投票这个动作 (未投的 CTA + 提交投票 + 剩余票数), 琥珀 amber = 选了还没
    提交 / 还没开投, 翠绿 emerald = 已提交, 金 gold = 名次与荣誉 (奖牌用渐变，所以琥珀不会同时表示
    「待提交」和「第一名」). Discipline is what keeps it from looking cheap: **only the CTA is a solid
    saturated block**, both feedback states are tinted-fill + strong text, and the rule chips /
    search / sort stay ink — metadata never takes colour, which is what leaves the coloured things
    meaning something. The card 投票 button is `h-9/13px` on purpose (the old `h-8/11px` ink pill
    was invisible in a grid of forty). Do NOT "restore" these to zinc-900 for consistency with the
    rest of the app, and do not add a fifth hue.
  - Adding a vote fires ONE 620ms confetti burst (`VoteBurst.tsx` + the `vote-confetti` /
    `vote-ripple` / `vote-pop` keyframes in `globals.css` — keyframes must live there, not in
    tailwind.config, or they are silently dropped). It fires only on a real `+1` (never on 撤票,
    提交 or paging), the 12 particles are hard-coded rather than random (identical every time =
    designed, not jittery), it only flies UPWARD because the card's `.cv-auto` paint containment
    clips anything leaving the card box, and it renders nothing under `prefers-reduced-motion`.
    The `popId` window in `VoteGallery` (700 ms) must stay longer than the animation or particles
    are unmounted mid-flight.
- **导航栏 (2026-08-27) is measured, not guessed.** `components/nav-items.ts` is the destination
  catalog; `components/nav-overflow.tsx` renders it. The row is `flex-1 min-w-0 overflow-hidden`
  between a `shrink-0` logo and a `shrink-0` action cluster, so its `clientWidth` IS the budget: it
  caches each link's natural width (after `document.fonts.ready` — a fallback-font pass measures
  wrong) and keeps only what fits, handing the rest to the overflow menu through a context the
  header wraps. **Never add a nav link by hand to the header** and never re-introduce a fixed
  `hidden md:flex` list — that is exactly what ran "Docs" under the search box in English and left
  phones with no navigation at all. 中文 fits 6 inline at 1440, en fits 6, fr fits 5, a phone fits
  0; nothing is clipped in any of them because the row measures instead of assuming.
  `PRIMARY_NAV` competes for the row; `STASHED_NAV` (投票 / 文档 / 意见反馈) is always in the menu.
  **Display names (owner, 2026-09-15)**: the zh nav labels are 视频 / 文章 / 动态 / 技术 (were
  Videos / 知识库 / 讨论区 / 技术专区; en Feed·Articles·Tech, fr Actualités·Articles·Tech). Only the
  `nav.*` labels and the 动态 page title changed — routes, the `/library` H1 (it reads
  `nav.library`), admin UI and the many 知识库/技术专区 strings inside features did NOT.
- **悬停面板 `components/NavMegaPanel.tsx` (2026-09-15) never scales text.** The first cut morphed
  between items with framer `layout` + Aceternity's `damping: 11.5` spring; `layout` animates the
  box with a SCALE transform, so sliding 技术 → 动态 painted the two-link menu at the 研究所 grid's
  scale — giant text spilling out of the panel, then shrinking (owner: 「直接变为大字然后再缩小」).
  Now: the viewport animates real `width`/`height` motion values to the measured size of the
  current pane (`overflow-hidden`, ring instead of border so measured size = box size), the shell
  slides by `x`, and panes crossfade with a 20px drift in the pointer's direction — all
  `TWEEN_PANE`, no spring. The first measurement `set()`s (opens in place), later ones `animate()`;
  only the PRESENT pane (`useIsPresent`) may report a size, and the travel direction is decided
  during render (an effect would lag one hand-off). Do not bring back `layout` on this panel.
- **收纳菜单 `components/NavMoreMenu.tsx`** is the React Bits `<BubbleMenu />` *motion* on
  framer-motion — deliberately NOT the component: the original is a GSAP full-viewport takeover
  with 4rem rotated pills, which would have added a second animation library to animate three
  utility links on a 56px bar. Kept: `back.out(1.5)`-shaped overshoot (`BACK_OUT` cubic-bezier),
  per-item stagger, labels sliding up a beat behind their bubble, the two-line toggle morphing
  into an X. Changed: the ±8° tilt is the ENTRANCE only and settles to 0 (a permanent tilt reads
  as sloppy alignment in a 9-row stack at 13px), and the pills are ink — hover fills with
  `zinc-900`/`zinc-100` rather than the original's per-item hue, per the 配色契约. The panel is
  PORTALED via `useAnchoredPanel` because `NavBarShell`'s `transition-transform` makes it a
  containing block for `position: fixed`.
- **首页 (signed-in home)**: `app/_components/CommunityHome.tsx`. Band order is
  hero (greeting + 今日 figures, **GitHub 热榜**, shorts player) → 社区此刻 → 热门 Skills → 热门视频;
  热门 Skills deliberately sits BELOW 社区此刻 (it used to own the hero-left slot the 热榜 now has).
  It follows the 配色契约 above: ink chrome, and the material (spines, language dots, category
  chips, avatars, video frames) in colour. Do not reintroduce tinted icon chips
  (`bg-accent-500/15` + icon), accent link colours or blurred colour glows — that combination is
  what the user rejected as "太 AI" — and do NOT grey the content out again either, which is what
  the user rejected next. `HeroBackdrop` is colourless (hairline grid + neutral overhead light +
  an inlined feTurbulence grain tile; the light-mode gradient MUST keep its `dark:hidden` or it
  washes out the dark hero). `SectionHeader` closes with a hairline rule instead of a chip. The
  hero brief lines carry the source's own dot (event kind / amber for 公告) and the empty shorts
  slot carries an upload CTA rather than 520px of void. **No `contain: paint` on the hero
  section** — paint containment makes it a containing block for `position: fixed` descendants,
  the same trap as `card-hover`'s transform. `SkillCard` titles are `line-clamp-2`, never
  `truncate` (a one-line clamp cut real names in half at every grid width under four columns).
- **GitHub 热榜**: `lib/github-trending-shared.ts` is the pure, unit-tested half (types +
  `parseTrendingHtml`, dependency-free regex — one trending page is ~650 KB and gets re-parsed on
  every cache miss, so no jsdom; it drops `<svg>` blocks WHOLE before tag-stripping because the
  path `d` attributes are full of digits that would otherwise be parsed as the star count).
  `lib/github-trending.ts` is server-only: `egressFetch` (github.com is EXTERNAL, so it tunnels
  through the corporate proxy on the intranet), a per-period module cache, in-flight dedupe, a
  2 MB body cap, and a 60 s failure backoff — without that backoff an unreachable github.com would
  fire a fresh 15 s request on every homepage render. **Refresh cadence is `GITHUB_TRENDING_TTL_HOURS`,
  default 12** (≈2 upstream hits/day/window, 6 across all three; trending itself only moves daily,
  so a short TTL buys nothing and just spends the outbound budget). Past the TTL the cached list is
  still served INSTANTLY while a refresh runs behind it; a request only waits on github.com again
  past `max(24 h, 2 × TTL)`, so raising the TTL can never put a blocking fetch back on the
  homepage's critical path. The RSC calls
  `getTrendingWithin('daily', 1500)` (the homepage is `force-dynamic`, so a cold cache must NOT
  block the render; past the budget it returns null and the client leaf fetches from
  `/api/github-trending`) plus `warmTrending()` for the other two windows. `GITHUB_TOKEN` is
  optional and only unlocks REST enrichment (topics/license/issues) — unauthenticated is 60
  req/hour and one full refresh costs up to 75, so it is skipped entirely when unset and the row
  must look complete without it. Contributor avatars are deliberately NOT rendered: the intranet
  cannot reach `avatars.githubusercontent.com`. i18n namespace `github_trending`; star/fork totals
  are formatted `en-US` on purpose so a 中文 viewer sees `12.4k` like github.com, not `1.2万`.
