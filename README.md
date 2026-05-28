# NLP Connect — AI-Powered QA Call Center

> **Harvesters International Christian Centre**
> Built for the Next Level Prayer (NLP) Conference and reusable for any church event.

## What It Does

NLP Connect eliminates the "air gap" in church follow-up calls. Agents call from the browser (WebRTC), all calls are recorded, and AI automatically:

- **Transcribes** every call (Deepgram Nova-3)
- **Extracts** next steps the attendee verbally committed to
- **Captures** testimonies shared during calls
- **Scores** script adherence (0–100%)
- **Flags** suspicious calls (short calls, no attendee speech, low adherence)

Phone numbers are **never visible** to agents — the server dials on their behalf.

---

## Tech Stack (Cost-Optimized)

| Layer | Technology | Cost |
|-------|-----------|------|
| Frontend + API | **Next.js 16** (App Router, Turbopack) | Free |
| Database + Auth | **Supabase** (Postgres + RLS + Auth) | Free tier |
| Telephony | **Twilio** (WebRTC + PSTN) | Pay-per-use |
| Transcription | **Deepgram** Nova-3 | $200 free credit |
| AI Analysis | **Google Gemini 2.5 Flash** | Free tier |
| Hosting | **Vercel** | Free tier |

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo-url>
cd HarvestersCallApp
npm install
```

### 2. Set Up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `supabase/schema.sql`
3. Copy your project URL and keys

### 3. Set Up Twilio

1. Create a Twilio account and buy a phone number
2. Create an API Key (Account → API Keys)
3. Create a TwiML App (Voice → TwiML Apps) — set the Voice URL to `https://your-app.vercel.app/api/twilio/voice`

### 4. Get API Keys

- **Deepgram**: Sign up at [deepgram.com](https://deepgram.com) (free $200 credit)
- **Google AI**: Get a key at [aistudio.google.com](https://aistudio.google.com)

### 5. Configure Environment

```bash
cp .env.local.example .env.local
# Fill in all the values from steps 2-4
```

### 6. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
HarvestersCallApp/
├── app/
│   ├── page.js                    # Login page
│   ├── layout.js                  # Root layout + AuthProvider
│   ├── globals.css                # Full design system
│   ├── agent/
│   │   ├── layout.js              # Agent route guard
│   │   └── page.js                # 3-panel agent workspace
│   ├── admin/
│   │   ├── layout.js              # Admin route guard
│   │   ├── page.js                # QA Command Center dashboard
│   │   ├── campaigns/page.js      # Campaign CRUD + CSV import
│   │   ├── calls/page.js          # Call logs with transcript viewer
│   │   └── flags/page.js          # Red flag review queue
│   └── api/
│       ├── twilio/
│       │   ├── token/route.js     # WebRTC access token
│       │   ├── voice/route.js     # TwiML (server-side phone lookup)
│       │   ├── call-status/route.js
│       │   └── recording-status/route.js
│       ├── leads/
│       │   ├── fetch-next/route.js # Atomic lead locking
│       │   └── release/route.js    # Lock release
│       ├── calls/
│       │   └── submit-results/route.js
│       └── ai/
│           └── process-call/route.js  # Deepgram + Gemini pipeline
├── components/
│   ├── Navbar.js
│   ├── ProtectedRoute.js
│   ├── LeadCard.js                # Attendee info (no phone shown)
│   ├── ScriptDisplay.js           # Dynamic call script
│   ├── CallDialer.js              # WebRTC controls
│   ├── AIResultsPanel.js          # AI results review
│   ├── Leaderboard.js             # Live agent rankings
│   ├── TranscriptViewer.js        # Transcript + flags display
│   └── AudioPlayer.js             # Call recording playback
├── hooks/
│   ├── useAuth.js                 # Auth context + RBAC
│   ├── useCall.js                 # WebRTC call management
│   └── useLead.js                 # Lead locking + polling
├── lib/
│   ├── supabase.js                # Supabase clients
│   └── constants.js               # Status enums + thresholds
└── supabase/
    └── schema.sql                 # Full DB schema + RLS
```

---

## User Roles

| Role | Access |
|------|--------|
| **Agent** | Agent workspace, make calls, confirm AI results |
| **Admin** | Everything + dashboard, flags, campaigns, call logs |
| **Super Admin** | Everything + user management |

New users are assigned the `agent` role by default. Admins promote users via the Supabase dashboard.

---

## Key Security Features

- 🔒 **Phone number masking** — agents never see phone numbers
- 🔐 **Row Level Security (RLS)** — agents can only see their own data
- ⏱️ **Irrefutable timestamps** — server-side call timing (no agent manipulation)
- 🤖 **Automated QA** — AI flags suspicious calls for admin review
- 🔑 **Role-based routing** — separate agent/admin dashboards

---

## CSV Import Format

Upload attendee lists via Admin → Campaigns → Import Leads:

```csv
full_name,phone_number,zone
John Doe,+2341234567890,Zone A
Jane Smith,+2340987654321,Zone B
```

Any extra columns beyond `full_name` and `phone_number` are saved as metadata.
