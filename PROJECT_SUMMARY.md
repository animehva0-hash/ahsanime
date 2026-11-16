# NamasteAnime — Complete Build Document (AI handoff / clone guide)

> Hand this file + the repo to any AI agent and it can rebuild the whole product.
> Everything below is verified against the live running app.

---

## 1. Product

Ad-free anime discovery + streaming web app.
Metadata from **AniList GraphQL**. Playback resolved from public third-party
providers (5 independent layers). Subtitles translatable live into **54 languages**
with **Gemini** (temporary, auto-deleted when the viewer stops watching).

**Stack:** Next.js 16 App Router · React 19 · TypeScript 5.9 · Tailwind CSS 4 ·
PostgreSQL + Drizzle ORM · hls.js · lucide-react.

---

## 2. Environment

| Key | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Postgres connection string |
| `GOOGLE_TRANSLATE_API_KEY` | optional | — | Gemini AI Studio key, **server-side only** |
| `GEMINI_TRANSLATE_MODEL` | optional | `gemini-3.5-flash-lite` | thinking model, budget capped at 256 |
| `STREAM_SOURCES_API` | optional | `https://anikuro.to/api/getsources/` | fallback aggregator base |

Keys are read via `src/lib/runtime-config.ts`, which tries `process.env` first and
then `secrets.local.json` (so a wiped `.env` never breaks translation).
**Model chain fallback:** `gemini-3.5-flash-lite → gemini-flash-lite-latest → gemini-2.5-flash → gemini-flash-latest`.

---

## 3. Source layers (all verified working)

### 3.1 AniList — metadata (`src/lib/anilist.ts`)
- `POST https://graphql.anilist.co`, no auth.
- **Rate limits:** 90/min documented, currently degraded to **30/min**. Headers:
  `X-RateLimit-Limit`, `X-RateLimit-Remaining`; on 429 → `Retry-After`, `X-RateLimit-Reset`.
- Client features: 2-slot inflight semaphore, adaptive spacing 750ms→2600ms,
  bounded 429 retry (≤2 attempts, ≤15s), 90s negative cache, bounded LRU cache (400).
- **GraphQL gotchas:** `MediaSort.UPDATED_AT_DESC` (NOT `UPDATED_TIME_DESC`);
  `Media.externalLinks` takes no `sort` argument; unused variables cause 400.
- `episodeTotal()` returns AIRED episodes: prioritises `nextAiringEpisode.episode - 1`
  over AniList's planned `episodes` count, so grids never list unaired episodes.

### 3.2 Anikoto catalog chain — primary playback (`src/lib/stream/anikoto.ts`)
```
GET  https://anikoto.cz/filter?keyword={title}
     → anchors https://anikoto.cz/watch/{slug}
GET  {watchUrl}/ep-1                       → data-anime-id="{internalId}"
GET  /ajax/episode/list/{internalId}       → <li><a data-id data-num data-ids="{TOKEN}">
GET  /ajax/server/list?servers={TOKEN}     → <div data-type="sub|hsub|dub">
                                               <li data-link-id="{LINK}">Vidstream-2|HD-1|VidPlay-1</li>
GET  /ajax/server?get={LINK}               → {result:{url:embed, skip_data:{intro,outro}}}
GET  {embed}                               → base_url:'https://megaplay.buzz/' + data-id="{ID}"
GET  {base_url}/stream/getSources?id={ID}&type=sub|dub
     → {sources:{file:"…master.m3u8"}, tracks:[{file:"…English.vtt",kind:"captions"}]}
```
- Up to 10 title candidates walked until one actually contains the requested
  episode (stops movies/specials hijacking a series).
- **Link-rotation resilient:** no host whitelist. `base_url` + `data-id` are
  discovered from the live embed page, so if the embed domain changes tomorrow
  the resolver keeps matching automatically.
- Shared `sourcesFromEmbed()` is exported for reuse by other layers.

### 3.3 ani.pm 19-server layer (`src/lib/stream/anipm.ts`)
```
GET https://ani.pm/api/anime/search?q={title}     → internal catalog id
GET /api/anime/ep-servers/{internalId}/{ep}       → named server tokens + type
GET /api/anime/ep-embed?id={token}                → embed url
→ sourcesFromEmbed(embed) → getSources → real HLS + VTT
```
19 servers (Helios/Zephyr/Drift/Pulse/Lyra/Halo/Comet/Onyx/Quasar/Astra/Orion…).
Unique value: resolves **DUB direct-HLS** servers (Vidstream-2/HD-1) that anikoto
alone doesn't. Their "Helios" = MegaPlay-by-AniList.

**Every HLS URL is validated (`isPlayable`) before it is exposed** — ani.pm and
anikoto sometimes return expired/rotated playlists (upstream 404), which used to
render dead HD-1/HD-2 pills. Validation = HEAD then GET `#EXTM3U` check with the
correct Referer; a 404/410 drops the link, other statuses keep it (may be
referer-gated).

### 3.4 JustAnime (`src/lib/stream/justanime.ts`)

Clean ID-based REST API:

```text
GET https://core.justanime.to/api/watch/{anilistId}/episode/{ep}/availability
GET https://core.justanime.to/api/watch/{anilistId}/episode/{ep}/{provider}
```

Returns direct HLS/MP4, subtitle tracks, provider Referer, intro and outro.
Providers include MegaPlay, AniNeko/Anivibe and AnimeGG/Vidwish. Vidwish uses
progressive MP4; the player detects `.mp4`, bypasses hls.js and uses native
`<video>` with proxy Range/206 forwarding.

### 3.4b 4Animo (`src/lib/stream/animo.ts`) — Vercel-safe

```text
GET https://cdn.4animo.xyz/embed/{hd-1|hd-2}/ani/{anilistId}/{ep}/{sub|dub}
→ HTML: var sourcesUrl = '/stream/getSources?t={token}'
GET https://cdn.4animo.xyz{sourcesUrl}
→ 1080p HLS + English caption track
```

**Vercel/serverless egress resilience:** if the host cannot reach
`cdn.4animo.xyz`, `fetchOne` returns an **embed-only server** (hls=null +
embedUrl) instead of dropping it, and `/api/stream/fast-sources` returns all
candidates on validation timeout. The browser can often reach the CDN directly
even when the server cannot, so Animo HD-1/HD-2 always appear in the list.

**Dragon Girl Problem fix (AniList ID `213094`):**

- Animo HD-1/HD-2 were available and playable, but the full multi-provider
  resolver took 8–12 seconds on a cold cache, so users thought they were absent.
- `/api/stream/fast-sources?animeId&ep` validates deterministic 4Animo embed
  pages in parallel and returns Animo HD-1, Animo HD-2 and their DUB variants
  before the full resolver completes.
- `player.tsx` starts fast and full requests in parallel. The fast response
  paints embed-capable pills; the full response replaces them with direct HLS
  + English VTT without a page reload.
- Verified on Dragon Girl Problem EP1: both direct playlists return
  `200 #EXTM3U`, DUB variants are present, English VTT is available and Gemini
  translation is configured.

### 3.6 AniKage media API (`src/lib/stream/anikage.ts`)
```
GET https://anikage.cc/api/media/anime/search?q={title}   → slug (match anilistId)
GET /api/media/anime/{slug}/episodes                      → episode presence
GET /api/media/anime/{slug}/episodes/{ep}/sources?provider={uwu|koto|neko|ken}
   → sources[]  m3u8 = https://gg.akage.lol/m3u8/{token}
   → subtitles[] vtt = https://gg.akage.lol/stream/{token}
```
Providers: `uwu` (servers beep/mimi/yuki/neko/kiwi/sora), `koto`, `neko` (softsub
+hardsub), `ken`. Softsub carries English VTT → translation-ready.
**Streams are stubbed off** (`DISABLE_STREAMS`) because `gg.akage.lol` is
TLS-blocked from sandboxes. Metadata + VTT discovery still work.

### 3.5 AnimeKai ID-synthesised servers (`src/lib/stream/animekai.ts`)
Built directly from ids, **no scraping**:
- **ANI 2** → `https://megavid.buzz/aniwave/al/{anilistId}/{ep}/{sub|dub}`
- **HD-3** → `https://megaplay.buzz/stream/mal/{malId}/{ep}/{sub|dub}`
- **HD-5** → `https://tryembed.us.cc/embed/anime/{anilistId}/{ep}/{sub|dub}`
(ANI + HD-4 removed: unreliable, no translation support.)

### 3.6 AniKuro aggregated fallback (`src/lib/stream/resolver.ts`)
```
GET {STREAM_SOURCES_API}?id={anilistId}&lol={provider}&ep={n}
providers: anikoto, animix, animepahe, senshi, reanime, allani, animedao, animedunya
→ {sub:{default, sources:[{url, originalUrl, headers:{Referer}}], subtitles:[…]}, dub:{…}}
```
Fired in waves (2 → 3 → 3) with early exit.

### 3.7 MegaPlay embeds (`src/lib/sources.ts`) — always-available last resort
`https://megaplay.buzz/stream/ani/{anilistId}/{ep}/{sub|hardsub|dub}`.
The player also listens to MegaPlay's documented `postMessage` events
(`time`, `watching-log`, `complete`) for caption sync and next-episode prompts.

### 3.8 Host → Referer map (critical, otherwise 403)
| Host pattern | Referer |
|---|---|
| `akage.lol` | `https://anikage.cc/` |
| `cdn/ncdn.kryntal.top`, `megap.*`, `watching.onl` | `https://megaplay.buzz/` |
| `akirax.buzz`, `shiora.top`, `mikora.top`, `vidtub*` | `https://vidtube.site/` |
| `echovideo`, `burntburst` | `https://play2.echovideo.ru/` |
| anything else (rotating segment CDNs e.g. `*.sugevideo.xyz`) | default `https://megaplay.buzz/` |

**Critical video bug fixed here:** segments live on rotating hosts different from
the playlist host. The playlist request therefore stamps its Referer into every
rewritten child URL (`&ref=`), otherwise segments return 403 and you get
subtitles-with-no-video.

Server naming: `cdn.kryntal.top→Vidstream-2`, `megap.*→HD-1`, `ncdn.kryntal.top→HD-2`,
`s1.akirax.buzz→VidPlay-1`.

### 3.9 Blocked in sandbox (do NOT attempt; the "skip on error" rule applies)
| Host | Why skipped |
|---|---|
| `anisnatch.to` | Cloudflare JS challenge on watch pages |
| `megaup.store` | 403 on every link (auth-token expiry) |
| `gg.akage.lol` | **TLS-level packet filter** — OpenSSL `tlsv1 alert internal error` on any edge IP. Headers/UA cannot help. The resolver (`src/lib/stream/anikage.ts`) detects and returns nothing at metadata level so the player never sees broken links. Remove the `DISABLE_STREAMS` stub when running on a host with unrestricted egress (e.g. your own Vercel deploy). |
| `animepahe` | Cloudflare |
| `kitsunekko.net` | DNS blocked |
| `api.anify.tv` | dead |
| `kaa.lt` | KickAssAnime v3: Nuxt SSR, stream API is **obfuscated + served over a `/ws` websocket** with Cloudflare Turnstile — not scrapable server-side |
| `xanime.me` | Episode pages expose expiring m3u8 links (`xanivsrc*.org`, needs `Referer: https://xanime.me/`), but they live inside **obfuscated JS arrays** (`\u0002…` control-char packed) with no reliable Sub/Dub label, and each needs a per-episode scrape. Not safe to wire up blind. |
| `just4anime.online` | Next.js app with `BAILOUT_TO_CLIENT_SIDE_RENDERING` — stream servers (aniDB/Jin/MEGAvid/dio) load via client-side JS whose fetch endpoint is not reachable server-side. Only `/api/episodes/{id}` (metadata) is public. |
| `animotvslash.org` | WordPress/animestream theme. Servers (ANIMO-M/H/D, Animo, Moon, Hydrax, VidHide, Vidara for sub + soft_sub) resolve via `tsLoadServerBtn` → obfuscated `jw-player/{base64}` tokens (decodable, but only the trailer URL is inline; the real ones need their JS). Cloudflare Turnstile `data-sitekey` present. |
| `anixo.buzz` | embed loads fine but streams never start in our player context (removed at user request) |

Embedding `CloudflareBypassForScraping` is not possible here — it needs a
Puppeteer/browsers, and inter-process spawning is not supported in this sandbox.

### 3.10 Mobile UX notes
- Server card: horizontal snap-scroll row on mobile (never clips server pills).
- DUB-side pills hidden below `md` to keep 필sicsable space sane.
- Translate captions button: sticky FAB (`bottom-4 right-3`) on `sm:hidden` +
  embedded in the HLS controls.
- Player frame: `16:9 aspect-video` with `min-h-[480px]` in landscape so it never
  collapses to a sliver.

Community mirrors worth knowing: `github.com/Shineii86/AniKotoAPI` (33+ endpoints
for the same Anikoto catalog, demo `anikototvapi.vercel.app` — we implement the
chain ourselves so no dependency).

---

## 4. HTTP API

| Route | Method | Notes |
|---|---|---|
| `/api/health` · `?deep=1` | GET | DB + auto schema; deep adds AniList quota + catalog + translation stats |
| `/api/search?q=` | GET | AniList autocomplete |
| `/api/list?kind\|genre\|format\|search&page=` | GET | Browse feed. kinds: trending/updated/added/popular/upcoming/ongoing/complete |
| `/api/watchlist` | GET/POST/DELETE | Per `na_uid` cookie |
| `/api/history` | GET/POST/DELETE | Continue watching |
| `/api/contact` | POST | formsubmit.co → inrelam@gmail.com; 3 msgs / 10 min per IP |
| `/api/stream/sources?animeId&ep` | GET | Merges ALL layers → `{provider, sub, hsub, dub, embeds}` where each side is `{servers:[{id,label,url,embedUrl}], subtitles:[{label,url}]}` |
| `/api/stream/proxy?url&ref` | GET | HLS proxy: referer inheritance, playlist rewriting, TS sync-byte fix |
| `/api/stream/subtitle?url=` | GET | English VTT proxy, forced `text/vtt` |
| `/api/stream/subtitle/languages` | GET | 54-language catalog + provider/model/key status |
| `/api/stream/subtitle/translate?url&lang&animeId&ep&sessionId` | GET | Translated VTT |
| `/api/stream/subtitle/translate?sessionId&animeId&ep` | DELETE | Cleanup |
| `/random` | GET | 307 → random anime (randomized sort + deep page) |

Rate limits (per IP, sliding window, `src/lib/rate-limit.ts`):
translation 12/min · proxy 240/min · subtitle 120/min · contact 3/10min.

---

## 5. Subtitle translation pipeline

1. `fetchSubtitleCues()` — downloads track (host-aware Referer, SSRF guard, 5MB cap)
   and normalises VTT/SRT/ASS into cues. Cache: bounded LRU, 40 entries, 30 min.
2. `mergeOverlappingCues()` — collapses overlapping sign + dialogue cues and trims
   overlaps **before** translating. This is what keeps translated text in sync.
3. `translateCues()` — **batches of 60**, 3 waves in parallel, structured JSON
   (`responseMimeType: application/json` + `id`/`text` responseSchema),
   `thinkingConfig.thinkingBudget: 256` to cap thinking-model latency.
4. **Repair pass** — re-asks once for any ids a batch dropped, so nothing silently
   stays English. A totally failed batch never fails the episode (cues keep
   original English at original timings).
5. `applyReplacements()` — `replacements_lines.txt` then `replacements_words.txt`.
6. Stored per `sessionId` for **10 minutes** and serialised to valid VTT.

**Temporary by design — storage never fills:**
- TTL 10 minutes per translation
- Cleanup on `pagehide`, `beforeunload`, `visibilitychange→hidden`, and component
  unmount (route change / episode change)
- 60s sweeper calls `purgeIdleSessions()` + `capSessions(300)`
- Nothing is ever written to disk; all caches are in-memory with hard entry caps

**Hinglish prompt** (casual by design): Roman script only (never Devanagari),
"the way a young Indian friend actually talks" — yaar/arrey/matlab/bas/bilkkul
freely mixed with English, contractions and slang welcome, never shuddh Hindi.
Character names, honorifics, tone, emotion and punctuation preserved.

**Completeness guarantee (98.5%+ measured):**
- Repair pass now retries **every** missing cue (not just batches of 3+), up to 3
  attempts with progressively smaller batches, stopping early if no progress.
- When the model returns fewer lines than the source cue has, the **translation
  is kept and rebalanced** across the source line count instead of falling back
  to English.
- Measured on Dragon Girl Problem EP1 (267 cues): 263 Hinglish, 4 English
  (2 fan-sub credits, 1 song lyric `♪`, 1 edge case) → **98.5%**.
- Remaining English lines are almost always intentional: credits, `[signs]`,
  `(sound effects)` and song lyrics.

**Line-structure enforcement** (`clampLine` + `rebalance` in `gemini.ts`):
- Source cue with N lines → translated cue returns EXACTLY N lines
- Too many lines → rebalanced into the source count
- Too few lines → falls back to the original English (never mis-times)
- Every line clamped to 42 chars (breaks on spaces, never mid-word)

**Glyph normalisation** (`normaliseGlyphs` in `vtt.ts`, applied after
replacements): smart quotes/apostrophes → ASCII, em/en dashes → `-`, ellipsis →
`...`, fullwidth `！？，；：` → ASCII, zero-width/BOM/control chars stripped.
Stops Gemini emitting typographic glyphs that render inconsistently in
`<track>` cues.

**Caption CSS defaults**: `font-size: clamp(0.95rem, 3.4vw, 1.25rem)` (fluid, so
a 2-line cue always fits a 320px phone), `line-height: 1.3`,
`max-height: 2.7em`, `text-wrap: balance`, `padding-inline: 0.35em`.

**Caption settings panel** (`⚙` next to the CC button in the player):
- *Style tab* — Font size slider (60%–220%), 8 preset colours + custom colour
  picker, background mode (Outline / Box / None), Bold and Italic toggles
- *Position tab* — Vertical position slider (20%–96%) + Top/Middle/Lower/Bottom
  presets, live preview
- Persisted in `localStorage` under `na_caption_settings`
- Applied to **both** renderers: native `<track>` cues via an injected
  `#na-cue-style` `<style>` element (`captionCueCss`), and the iframe caption
  overlay via inline styles (`captionOverlayStyle`)
- Implementation: `src/lib/caption-settings.ts` + `src/components/caption-settings-panel.tsx`

### SEO
- `src/app/robots.ts` — allows `/`, disallows `/api/` and `/watch/` (thin
  content), declares the sitemap + host
- `src/app/sitemap.ts` — 36 URLs: 12 static routes, 18 genre pages, 6 type pages
- `src/app/layout.tsx` — `verification.google` =
  `-BD_PRi36Bw9HqSJZh7zmOhmR1xVvBvSMM9XRIpeemY`,
  `msvalidate.01` = `76F5AAD910BB922756D179F24026E9E8`, plus OpenGraph/Twitter
  cards and an explicit `robots` block (index/follow, large image preview)
- `next.config.ts` — full security-header set (CSP, HSTS preload, nosniff,
  X-Frame-Options, Referrer-Policy, Permissions-Policy) applied to every route
  via `headers()`

---

## 6. Database (`src/db/`)

Auto-created by `ensureSchema()` — idempotent `CREATE TABLE IF NOT EXISTS`, cached
per process, invoked from `/api/health`, `/api/watchlist`, `/api/history`.
`npx drizzle-kit push` is optional.

```
watchlist(id, uid, anime_id, title_romaji, title_english, cover, color,
          format, status, score, created_at)   UNIQUE(uid, anime_id)

watch_history(id, uid, anime_id, episode, title_romaji, title_english,
              cover, color, watched_at)        UNIQUE(uid, anime_id)
```
Identity: anonymous UUID in `localStorage` mirrored to the `na_uid` cookie.

---

## 7. Player

- Embed loads **immediately**; direct HLS servers upgrade the frame in place once
  resolved (never a blocking spinner).
- Server card: mode tabs (Soft Sub / Hard Sub / DUB) on top, named server pills
  underneath — MegaPlay, Vidstream-2, HD-1/2, VidPlay-1, Koto/Neko/Beep/Mimi/Yuki/
  Kiwi/Sora, ANI 2, HD-3, HD-5, ani.pm dub servers. Translation-capable servers
  are amber with a 🌐 badge.
- Custom HLS player: quality selector from real HLS levels, Fit/Stretch
  (`object-fit`), volume, ±10s, fullscreen, keyboard (space/k, ←/→, ↑/↓, f),
  20-second bounded start, network/media error auto-recovery.
- Captions: no background box, bold white 1.1em, 1.5px black outline + drop
  shadow, line 92 % (controls hidden) / 88 % (hover) — near the bottom as requested.
  Old text tracks disabled + removed before a new one attaches.

---

## 8. Responsive / auto-sizing (Figma-style fluid design)

Fully fluid from 320px phones → tablets → laptops → ultrawide desktops, no
breakpoint jank. Every dimension derives from the viewport:

```css
--fs-base: clamp(0.8rem, 0.72rem + 0.25vw, 1rem);
--fs-hero: clamp(1.9rem, 1.2rem + 3.2vw, 4rem);
--gutter:  clamp(0.75rem, 0.45rem + 1.4vw, 2rem);
--card-w:  clamp(8.5rem, 6.6rem + 6.5vw, 12.5rem);   /* 136px → 200px */
```

### Page shell
`.shell` on every page (fluid gutter, `max-width: min(1600px, 100%)`).

### Cards & carousels
- Cards are `w-full` inside their track, `aspect-[2/3]`, `object-cover` →
  **the full poster is always visible** (no more half-cropped covers).
- `.row-track` — horizontal carousel:
  - children `flex: 0 0 var(--card-w)` + `scroll-snap-align: start`
  - `scroll-snap-type: x proximity` (gentle, not forced)
  - `-webkit-overflow-scrolling: touch` + `overscroll-behavior-x: contain`
  - negative margin + padding so the first/last card aligns with the page gutter
  - safe-area aware (`env(safe-area-inset-left)`)
- `.rail-track` — same for Continue Watching (wider tiles: `clamp(15rem, 60vw, 17rem)`).
- `.grid-fluid` = `repeat(auto-fill, minmax(var(--card-w), 1fr))` — as many cards
  as fit at any width (used on all browse/library/search pages).

### Video player
- `aspect-ratio: 16/9`, `min-height: clamp(230px, 40vw, 420px)`, `max-height: 82vh`
  → small on phones, full-size on desktop, never taller than the viewport.
- Mode tabs (Soft Sub / Hard Sub / DUB) become a full-width segmented control on
  mobile (`flex-1`), pills wrap and tighten.
- `.ctl` buttons `clamp(34px, 9vw, 40px)` — always tappable.
- **Small-screen control overflow fix:** the control bar uses
  `flex flex-wrap` (wraps to two rows on phones). The ±10s seek buttons were
  removed from the UI entirely (arrow keys / swiping the seek bar still work),
  which leaves the bar short enough that it never clips even on a 320px screen.
  Remaining controls: Play, time, Captions + Translate, Quality, Fullscreen.
- Mobile bottom-fixed translate toolbar (`sm:hidden`) so captions are 1 tap away.

### Performance
- **ISR caching** (`revalidate = 1800`) on home, discover, genre and type pages;
  `revalidate = 900` on anime detail. Repeat visits are served from the cache.
- `generateMetadata` uses a **tiny query** (`getMediaMeta`) instead of the full
  detail body, so the document title resolves without waiting on
  relations/characters/recommendations.
- The detail page backdrop reuses the **poster art** the visitor already has in
  their browser cache (saves a separate banner round-trip) and keeps the artwork
  visually consistent with the card they tapped.
- Measured: detail 1.86s cold → **0.04s warm**; home 2.43s cold → **0.03s warm**.

### Navbar
- Below `lg` (1024px — phones **and** tablets) the search field is **not** in
  the bar at all. The row is just `Logo · ENG/日本 · Library · 🔍 · ☰` so the
  logo never gets squeezed and nothing renders beside the menu button.
- The 🔍 button opens the menu panel, which holds the full-width search box
  (live autocomplete) as its first row.
- `lg` and up: the search field returns to the navbar row (`w-56 xl:w-64`).
- Search results dropdown: `left-0 right-0 w-full min-w-[260px] max-w-[320px]`
  so it can never overflow a narrow viewport.

### Translate bar placement
The language selector lives **under the video frame** (not inside the player
overlay), so on small screens the list can never be clipped by the video box.
Caption state is owned by `player.tsx` and passed into `hls-player.tsx` via
`captions` / `onCaptionsChange`, so picking a language immediately swaps the
`<track>` on the running video without a reload.

Translate-button reliability rules:
- `/api/stream/sources` merges VTT tracks from Anikoto, ani.pm, JustAnime and
  4Animo, deduplicates them, and sorts a real English track first.
- `player.tsx` explicitly matches `English`/`eng`, auto-selects the first direct
  HLS server, and renders the bar when `hlsDirect && englishUrl`.
- If AniList metadata is temporarily 403/429 blocked, ID-only JustAnime/4Animo
  resolvers still run and return direct HLS + English VTT, so the button remains
  available instead of disappearing with the title-dependent resolver branch.
- Embed-only MegaPlay/ANI 2/HD-3/HD-5 servers do not show a fake translate
  button because their internal caption tracks are inaccessible to our player.

### Translate language menu
- Width `min(18rem, calc(100vw - 1.5rem))` — never wider than the screen.
- Height `min(26rem, 65vh)` with `flex flex-col`; the language list is
  `min-h-0 flex-1 overflow-y-auto overscroll-contain`, so the header + search
  field stay pinned and **every language stays reachable by scrolling** (the
  old fixed `max-h-64` hid the top entries on short screens).

### Other breakpoints
- `text-size-adjust: 100%` (no iOS rotate zoom), `100dvh`/`svh` viewports
- `@media (pointer: coarse)` → 44px minimum touch targets
- `@media (max-height: 480px) and (orientation: landscape)` → shorter hero
- Banner heights use `svh` so mobile browser chrome doesn't clip them
- `overflow-wrap: anywhere` on long titles

---

## 9. Security (`src/middleware.ts` + `src/lib/rate-limit.ts`)

Security headers on every response (live-verified):
```
content-security-policy: default-src 'self'; frame-src 'self' https: data: blob:;
  img-src 'self' data: blob: https:; media-src 'self' blob: data: https:;
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https:;
  style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:;
  connect-src 'self' https: wss: blob:; worker-src 'self' blob:;
  object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
```
- Exploit-probe paths blocked (`/wp-*`, `/.env`, `/.git*`, `/phpmyadmin`, `/xmlrpc.php`, `..`)
- Per-IP sliding-window rate limits on expensive APIs (see §4)
- SSRF guard on all remote-fetch helpers (blocks localhost/private hosts)
- Gemini key is server-side only; never in the browser bundle
- Contact form input validation (length + email shape) + tight rate limit

---

## 10. Stability engineering (multi-user)

| Concern | Mitigation |
|---|---|
| Memory | **Every cache bounded** via `TtlCache` (`src/lib/lru.ts`): AniList 400, subtitles 40, anikoto/anikage/anipm/resolver 120, rate-limit buckets 2000, sessions ≤300 |
| OOM root cause (fixed) | unbounded subtitle cache (~80 KB/entry) killed long-running instances |
| Multi-user | 2-slot AniList semaphore; Gemini max 2 jobs + in-flight dedup |
| Fail-safety | 429 bounded retry, 90s negative cache, failed batch ≠ failed episode |
| Measured | 12 parallel mixed requests → **4.7s**, health stayed green |

`/api/health` output:
```
healthy | database:OK | translator:OK | anilist:OK | anikoto:OK
```

---

## 11. App features

Home spotlight carousel · Trending/Updated/Added/Popular/Upcoming/Ongoing/Complete
pages with infinite scroll · Genre (18) & Type pages · Random (varied sort+page) ·
debounced live search autocomplete · ENG⇄日本 title toggle · watchlist + continue
watching · airing countdown chip (`Next EP 10 in 04h 21m 58s`) · **auto-refresh
every 10 min** (`src/components/auto-refresh.tsx`, also on tab re-focus) ·
DMCA / Terms / Contact pages · custom 404.

---

## 12. Project layout

```
src/
├─ middleware.ts                     security headers + probe blocking
├─ app/
│  ├─ layout.tsx  page.tsx  loading.tsx  not-found.tsx
│  ├─ anime/[id]/page.tsx            details + episodes + countdown
│  ├─ watch/[id]/[episode]/page.tsx  player page
│  ├─ discover/[kind]/  genre/[genre]/  type/[type]/  search/  library/  random/
│  ├─ dmca/  terms/  contact/
│  └─ api/{health,search,list,watchlist,history,contact,random}/
│     └─ api/stream/{sources,proxy,subtitle,subtitle/languages,subtitle/translate}/
├─ components/  navbar, spotlight, row, anime-card, infinite-grid, player,
│               hls-player, translate-menu, caption-overlay, episode-grid,
│               watchlist-button, continue-watching, airing-countdown,
│               auto-refresh, providers, footer, page-header, description, title-text
├─ db/          index.ts, schema.ts, ensure-schema.ts
└─ lib/
   ├─ anilist.ts  sources.ts  lru.ts  rate-limit.ts  runtime-config.ts
   │              client-session.ts  utils.ts
   └─ stream/    anikoto.ts  anipm.ts  anikage.ts  animekai.ts  resolver.ts
                 gemini.ts  vtt.ts  fetch-subtitle.ts  replacements.ts
                 session-store.ts  queue.ts  languages.ts
```

Root files: `README.md`, `PROJECT_SUMMARY.md`, `secrets.local.json`,
`replacements_lines.txt`, `replacements_words.txt`, `public/sample-en.vtt`.

---

## 13. Commands

```bash
npm install
npm run dev                      # local dev
npm run build && npm run start   # production
npx next typegen                 # route types
npm exec tsc -- --noEmit         # typecheck
npx drizzle-kit push             # optional explicit schema push
curl localhost:3000/api/health?deep=1
```

Vercel: import repo → set `DATABASE_URL` (pooled, sslmode=require),
`GOOGLE_TRANSLATE_API_KEY`, `GEMINI_TRANSLATE_MODEL`. Tables auto-create on the
first `/api/health` hit. See README for the full walkthrough.

---

## 14. Known constraints

- Third-party providers rotate hosts and rate-limit aggressively; every layer
  degrades to the next and finally to the MegaPlay embed.
- AniList is in a degraded 30 req/min mode — keep the throttle.
- Serverless memory caches reset per instance (intentional for temporary translations).
- Anikoto search can pick a franchise entry when the exact series slug is absent;
  the episode-existence check keeps the requested episode number correct.
- Thinking model (`gemini-3.5-flash-lite`) is slower than `gemini-flash-lite-latest`
  (389-cue episode ≈5.5s on the latter); waves + repair + batch resilience absorb this.
