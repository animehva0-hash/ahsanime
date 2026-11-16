# 🙏 Namaste Anime

Watch anime online for free in HD quality with English sub and dub.
AI-powered temporary subtitle translation in 54 languages including casual Hinglish.

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-336791?logo=postgresql)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1-38bdf8?logo=tailwindcss)
![Gemini AI](https://img.shields.io/badge/Gemini_AI-Translation-orange)

---

## ⚡ Features

- 🎬 **Multi Streaming Servers** — Soft Sub, Hard Sub, English Dub (Vidstream-2, HD-1, VidPlay-1, ANI 2, HD-3, HD-5…)
- 🌐 **AI Subtitle Translation** — 54 languages via Gemini 3.5 Flash Lite (thinking model, 1M context) (Hinglish, Hindi, Japanese, etc.), temporary & auto-deleted
- 🔍 **Search** — Instant autocomplete + full results
- 📖 **Watchlist & Watch History** — Saved in PostgreSQL (anonymous session)
- 🔥 **Trending / Updated / Added / Popular / Upcoming / Ongoing / Complete** — dedicated browsable pages with infinite scroll
- 🎲 **Random Anime** — One click genuine surprise (randomized sort + deep random page)
- 🌏 **ENG ⇄ 日本 Toggle** — Switch every title between English & Romaji instantly
- 📱 **Fully Responsive (Figma-style fluid)** — 320px phones → tablets → laptops → ultrawide desktops, all auto-adjusting:
  - fluid type/gutter/card scales via `clamp()`
  - carousels scroll left↔right with snap, safe-area aware
  - **full poster art on every card** (no cropping)
  - auto-fill grids fit as many cards as the screen allows
  - player auto-sizes (`16:9`, clamped to viewport height)
  - mobile segmented mode tabs + bottom-fixed translate bar
  - 44px touch targets, no iOS rotate zoom
  - video controls wrap to two rows on phones (secondary controls hide below 400px instead of clipping)
  - mobile navbar stays clean — search lives in the menu panel behind a 🔍 button, never beside the ☰ button
  - the 🌐 translate control only appears on servers that actually expose an English subtitle track
- ⚡ **Fast** — ISR caching on every browse page; repeat visits load in ~30ms
- 🔒 **Security Hardened** — CSP + HSTS + anti-clickjacking headers, exploit-probe blocking, per-IP rate limits, SSRF guards, server-only API keys
- 💾 **Zero-Storage Subtitles** — Translations live only while you watch (RAM, TTL + idle purge + session cap); nothing is ever written to disk
- 🎮 **Custom HLS Player** — Quality selector (1080p/720p/360p), Fit/Stretch, keyboard shortcuts, seek bar, fullscreen
- 🔒 **No Adult Content** — All queries filter `isAdult: false`
- ⚡ **AniList Rate-Limit Smart Client** — Adaptive throttle + cache, survives the degraded 30 req/min quota
- ⏱️ **Airing Countdown** — Live ticking "Next EP in 2d 14h 32m" chip on every ongoing anime
- 🔄 **Auto Refresh** — Every 10 minutes the page revalidates itself and picks up newly aired episodes
- 📺 **Aired-Only Episodes** — Episode grid shows just what's actually released (e.g. "9 available of 14")
- 🏥 **Health System** — `/api/health` + deep probes (DB, AniList, catalog, translation)
- 🗄️ **Auto Schema** — Database tables create themselves on first request

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| Next.js 16 | App Router, SSR, API Routes |
| TypeScript | Type safety |
| PostgreSQL | Database |
| Drizzle ORM | Database queries |
| Tailwind CSS 4 | Styling |
| Lucide React | Icons |
| hls.js | HLS video playback |
| Gemini AI | Subtitle translation |

---

## 🚀 Setup (All Platforms)

### Requirements
- **Node.js 18+**
- **PostgreSQL 14+**
- **Gemini API Key** (free) — [Get it here](https://aistudio.google.com/apikey)

---

### Step 1: Clone & Install

```bash
git clone https://github.com/your-username/namaste-anime.git
cd namaste-anime
npm install
```

### Step 2: Create `.env` file

⚠️ **API key `.env` file mein lagani hai — code mein hardcoded NAHI hai!**
(Production safety fallback ke liye app `secrets.local.json` bhi read karti hai.)

Project root mein `.env` file banao:

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db

# Gemini API Key (subtitle translation ke liye)
# Free key yahan se lo: https://aistudio.google.com/apikey
GOOGLE_TRANSLATE_API_KEY=your-gemini-api-key-here
GEMINI_TRANSLATE_MODEL=gemini-3.5-flash-lite

# Optional — aggregated fallback source API
STREAM_SOURCES_API=https://anikuro.to/api/getsources/
```

### Step 3: Setup Database

#### 🪟 Windows
```powershell
# Install PostgreSQL (download from postgresql.org or use Chocolatey)
choco install postgresql
net start postgresql-x64-14

# Create database
psql -U postgres -c "CREATE DATABASE app_db;"
```

#### 🍎 macOS
```bash
brew install postgresql@14
brew services start postgresql@14
createdb app_db
```

#### 🐧 Ubuntu/Linux
```bash
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo -u postgres createdb app_db
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
```

### Step 4: Run

```bash
# Optional explicit push — app tables first request pe AUTO ban jaati hain
npx drizzle-kit push

# Start development server
npm run dev

# Open http://localhost:3000
```

### Step 5: Verify

Homepage automatically AniList se data laata hai (adaptive rate-limited client).
Health check:

```bash
curl http://localhost:3000/api/health?deep=1
# → {"status":"healthy", checks: database OK, translator OK, anilist OK, anikoto OK}
```

---

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection string |
| `GOOGLE_TRANSLATE_API_KEY` | ❌ Optional | Gemini key — translation without it disabled (English captions still work), menu config status dikhata hai |
| `GEMINI_TRANSLATE_MODEL` | ❌ Optional | Default `gemini-3.5-flash-lite` |
| `STREAM_SOURCES_API` | ❌ Optional | Fallback aggregator base URL |

**⚠️ Important:**
- Keys `.env` me lagao, code mein NAHI
- Gemini API key **FREE** hai — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) se lo

---

## 🌐 AI Subtitle Translation

### How it works:
1. Video play karo → SUB mode me 🌐 **Translate subtitles** (red button) dikhega
2. Language select karo (54 options — Hinglish, Hindi, Japanese…)
3. "Translating..." → replaced with a fresh VTT track, **video reload NAHI hota**
4. Cache **10 minutes** temp — page/episode leave par auto-DELETE cleanup request
5. Flow: Gemini structured JSON → `replacements_lines.txt` → `replacements_words.txt` → valid VTT

### Line structure & symbols
Source cues with 2 speech lines stay exactly 2 lines after translation (never
merged, never split further), each line clamped to 42 characters. Smart quotes,
em-dashes, ellipses and fullwidth punctuation are normalised to ASCII so
captions render identically in every browser.

### Timing sync safety
Overlapping sign/dialogue cues translate se **pehle merge** hote hain — isliye translated
text kabhi original timing se drift nahi hota. Strict id mapping guarantee: jo cue translate
na ho saka wo original English rehti hai, timing untouched.

### Supported Languages (54)
| Group | Languages |
|------|----------|
| 🇬🇧 Original | English |
| 🇮🇳 India | **Hinglish** (Roman — *"Yaar ye toh crazy hai!"*), Hindi, Urdu, Bengali, Tamil, Telugu, Marathi, Gujarati, Punjabi, Kannada, Malayalam, Nepali, Sinhala |
| 🌏 East Asia | Japanese, Korean, Simplified + Traditional Chinese, Thai, Vietnamese, Indonesian, Malay, Filipino |
| 🌍 Europe | Spanish, French, German, Portuguese, Italian, Dutch, Polish, Czech, Slovak, Hungarian, Romanian, Bulgarian, Croatian, Serbian, Slovenian, Greek, Russian, Ukrainian, Turkish, Swedish, Norwegian, Danish, Finnish, Estonian, Latvian, Lithuanian |
| 🌍 Others | Arabic, Persian, Hebrew, Swahili, Afrikaans |

### Post-processing corrections
```txt
# replacements_lines.txt
tumhari age kya hai => Tumhari umar kitni hai

# replacements_words.txt
age => umar
taqat => power
```

### Multi-user lifecycle
- Browser `sessionStorage` me unique translation session ID
- Server max **2 Gemini jobs** concurrently; baaki queue
- Batches of **60 cues**, 3 parallel waves + automatic repair pass for dropped ids
- 408/429/5xx → 3s/6s/9s backoff, up to 4 attempts
- 10 minute cache; episode change par older entries delete

### Example:
```
English:  "I will protect everyone no matter what!"
Hinglish: "Yaar main sabko protect karunga chahe kuch bhi ho!"
Hindi:    "मैं सबको बचाऊंगा चाहे कुछ भी हो!"
Spanish:  "¡Protegeré a todos sin importar qué!"
```

---

## 📺 Streaming Servers

Play button dabate hi embed instantly start hota hai; resolvers background me direct
servers dhoondte hain aur player in-place upgrade hua — **spinner pe kabhi atakta nahi**.

### Anikoto large-catalog (primary)
The app searches `anikoto.cz` by title, maps the internal anime ID, fetches the episode
token, resolves named SUB/HSUB/DUB servers, fetches each MegaPlay/VidTube embed, calls
`stream/getSources`, and extracts the **real HLS + English VTT**. Up to 10 title candidates
are walked until one actually contains the requested episode (no movie/special hijack).
AK Soft Sub = translation-ready. AK Hard Sub = playback-only.

### Soft Sub servers (translation-ready 🌐 — all links pre-validated)
| Server | Source |
|--------|--------|
| Vidstream-2 | Anikoto (cdn.kryntal.top) |
| HD-1 / HD-2 | Anikoto (akirax / ncdn.kryntal) |
| VidPlay-1 | Anikoto (akirax.buzz) |
| Koto / Neko / Ken / Uwu | AniKage GG streams (gg.akage.lol) — soft subs with English VTT |
| Vidstream-2 / HD-1 / VidPlay (ani.pm) | AniPM 19-server catalog — shared getSources (SUB + DUB direct HLS) |
| Megaplay / Anivibe / Vidwish | JustAnime REST API (direct m3u8 + English VTT, AniList-ID based) |
| Animo HD-1 / HD-2 | 4Animo embed → getSources (1080p HLS + English VTT) |
| Beep / Mimi / Yuki / Kiwi / Sora | AniKage uwu provider |
| ANI 2 | megavid.buzz aniwave (AniList) |
| HD-3 | MegaPlay (MAL) |
| HD-5 | tryembed.us.cc (AniList) |
| MegaPlay | Embed fallback (always on) |

### Hard Sub servers
| Server | Source |
|--------|--------|
| VidPlay-1 | Anikoto hsub (vidtube.site) |
| Beep / Mimi / Yuki / Neko / Kiwi / Sora | AniKage uwu hardsubs |
| MegaPlay Hardsub | Embed (burnt-in captions) |

### Dub servers
| Server | Source |
|--------|--------|
| AK Dub (named) | Anikoto dub bucket (when available) |
| Megaplay Dub / Vidwish Dub | JustAnime direct HLS (independent DUB layer) |
| Vidstream-2 / HD-1 Dub | AniPM direct HLS (getSources type=dub) |
| MegaPlay Dub | Embed (AniList) |
| ANI 2 Dub | megavid.buzz aniwave |
| HD-3 Dub | MegaPlay (MAL) |
| HD-5 Dub | tryembed.us.cc |

> ANI & HD-4 were retired — unreliable, and no soft-sub/translation support.

---

## 🗄️ Database Tables (auto-created)

| Table | Purpose |
|-------|---------|
| `watchlist` | Saved anime (unique per user+anime) |
| `watch_history` | Episode watch records for Continue Watching |

Tables create themselves via `ensureSchema()` on the first request —
`npx drizzle-kit push` optional hai.

---

## 🔧 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npx next typegen` | Generate route types |
| `npx drizzle-kit push` | Push schema to database |

---

## 🌐 API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/api/health` · `?deep=1` | Health (+auto schema), AniList quota, catalog, translation stats |
| `/api/search?q=` | Autocomplete suggestions |
| `/api/list?kind\|genre\|format\|search&page=` | Browse feed (trending/updated/added/popular/upcoming/ongoing/complete) |
| `/api/watchlist` | GET/POST/DELETE watchlist |
| `/api/history` | GET/POST/DELETE watch history |
| `/api/stream/sources?animeId&ep` | Server resolver (Anikoto → AniKuro waves → AnimeKai) |
| `/api/stream/proxy?url` | HLS/segment proxy (Referer + MPEG-TS mislabel fixes) |
| `/api/stream/subtitle?url=` | English VTT proxy (forced text/vtt) |
| `/api/stream/subtitle/languages` | 54-language catalog + key status |
| `/api/stream/subtitle/translate` | GET translate · DELETE cleanup |
| `/random` | Random anime redirect |

---

## 🚀 Production Deployment (Vercel)

### 1. Push to GitHub
```bash
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Import in Vercel
- Go to [vercel.com](https://vercel.com) → Import your repo (Next.js auto-detected)

### 3. Add Environment Variables
Vercel dashboard → Settings → Environment Variables:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require` (pooled URL) |
| `GOOGLE_TRANSLATE_API_KEY` | `your-gemini-api-key` |
| `GEMINI_TRANSLATE_MODEL` | `gemini-3.5-flash-lite` |

**Database options:** [Neon](https://neon.tech) (free), [Supabase](https://supabase.com) (free), [Vercel Postgres](https://vercel.com/storage)

### 4. Deploy & Verify
- Tables auto-create on first `/api/health` hit
- `https://your-app.vercel.app/api/health?deep=1` → `healthy`

---

## 🐛 Troubleshooting

### Database connection error
```bash
# Windows: net start postgresql-x64-14
# macOS: brew services start postgresql@14
# Linux: sudo systemctl start postgresql
```

### AniList rate limit (429s)
- Client already throttles adaptively; wait a few seconds
- AniList currently degraded to 30 req/min globally

### Subtitle translation slow / not showing
- `.env` me `GOOGLE_TRANSLATE_API_KEY` check karo (health endpoint status dekho)
- Pickup window: batches (30 × 3 parallel) — a 24-min episode typically completes well under a minute
- Key ke bina selector config status dikhayega; English captions fine chalengi

### Video not playing
- Server switch karo (Vidstream-2 ↔ HD-1 ↔ ANI 2 ↔ MegaPlay)
- Elements with `CC` badge hi translation-ready hain
- Segments rotate through CDNs — proxy referer-inheritance handles; agar ek segment fail ho jaye, server badlo

---

## 📱 Social

- 📷 Instagram: [namaste._.anime](https://www.instagram.com/namaste._.anime)
- 🎬 YouTube: [@namasteanime-p6n](https://youtube.com/@namasteanime-p6n)
- 📧 Email: inrelam@gmail.com

---

## 📝 License

This project is for educational purposes only. We do not host any video content.
Metadata and artwork courtesy of [AniList](https://anilist.co).

---

Made with ❤️ by Namaste Anime Team 🙏
