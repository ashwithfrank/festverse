# Supabase setup (about 10 minutes, free plan is enough)

FestVerse uses **only Supabase Realtime Broadcast + Presence**. There is **no database table, no SQL and no Row Level Security policy to create.** Nothing is stored in Supabase.

## 1. Create the project
1. Go to <https://supabase.com>, sign in, click **New project**.
2. Pick any name and region (choose one near you), set a database password (you will not need it), click **Create**. Wait until it finishes.

## 2. Allow public Realtime channels
FestVerse's channel is a *public* channel (no user accounts). Supabase can restrict a project to private channels only, so check this:

1. Dashboard → **Realtime** (left menu) → **Settings**.
2. Make sure **Enable Realtime service** is on.
3. Make sure **Channel restrictions** allows public access (the toggle is labelled along the lines of *"Allow public access"*). If public access is off, every connection fails with a "cannot connect" error.

> Supabase renames dashboard labels from time to time. If you cannot find the exact wording, look for the Realtime settings page and the option that permits public (non-authenticated) channels.

## 3. Copy the two public values
Dashboard → **Project Settings → API Keys** (or the green **Connect** button):

| Value | Where it goes in `js/config.js` |
|---|---|
| Project URL, like `https://abcdxyz.supabase.co` | `supabase.url` |
| **Publishable key** (`sb_publishable_...`) — or on older projects the legacy **anon** key | `supabase.publishableKey` |

**Never** copy the *secret* key or *service_role* key. They bypass all security and must never be in a website. The page refuses to start if it detects one.

A publishable/anon key is **public by design** (everyone who opens your site can see it). It is not a secret and cannot be hidden in frontend code.

## 4. Who can trigger the screen? (read this once)
A public Broadcast channel has no logins: *anyone who knows the project URL, key and channel name could send messages to it.* Since all three are visible in the website source, FestVerse adds its own lock:

- Every message is **signed with HMAC-SHA256** using a **control passcode** that exists only in two places: typed into the **display PC** and typed into the **organizer's phone** (stored in each browser's local storage, never in the code or on GitHub).
- The display ignores any message whose signature is wrong, whose id is malformed, or which is older than 3 minutes (`maxEventAgeSeconds`). A test message cannot be turned into an official one because the message type is part of the signed data.
- Choose a passcode of **8+ characters** that is not guessable. Do not share it in the group chat the website link is in.

Honest limits: this is a lightweight one-day protection, not account-based authentication. Someone who obtains the passcode could trigger the screen, and someone who knows the channel could spam it (messages would simply be ignored, but Supabase rate limits apply). If you want stronger isolation after the event, use Supabase Auth plus *private* channels with Realtime Authorization — not needed for this ceremony.

## 5. Limits to know about
- **Broadcast is not a queue.** A message sent while the display is offline is lost. FestVerse handles this by having the display send a **delivery confirmation** back; the phone shows "Display confirmed" or offers **RESEND SIGNAL** (same event id, so the display plays it at most once).
- Free plan limits (concurrent connections, messages per second) are far above what this uses (two devices, a few messages).
- Public Realtime connections are limited to roughly 24 hours each. FestVerse reconnects automatically; just do not rely on a tab that was opened days ago — **refresh both pages on the day**.
- Supabase free projects **pause after about a week of inactivity**. Open both pages a day before the event (the rehearsal does this) and, if the project shows as paused, restore it in the dashboard.
