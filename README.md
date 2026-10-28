# FestVerse — remote fest inauguration

Two pages on one GitHub Pages site, linked through Supabase Realtime:

| Public route | File | Opened on | Purpose |
|---|---|---|---|
| `/` | `index.html` | PC on the projector / LED wall | Pure black until the signal arrives, then the cinematic announcement |
| `/remote` | `remote/index.html` | Organizer's phone | Control console: confirm → **INAUGURATE FEST** |

Plain HTML/CSS/JS (ES modules). No build step, no framework, no server, no paid service.

```
festverse/
├── index.html              main display  ( / )
├── remote/index.html       remote        ( /remote )
├── 404.html                GitHub Pages fallback (keeps /remote alive)
├── .nojekyll
├── css/  main.css  animations.css  remote.css
├── js/   config.js  security.js  supabase-client.js  router.js
│         realtime.js  display.js  remote.js   (vendor/ = optional offline copy)
├── assets/images/logo.svg  assets/audio/   (put your logo / sound here)
├── README.md   SUPABASE_SETUP.md
```

## 1. How the routing works (and its one honest limitation)
GitHub Pages cannot rewrite URLs, so there is **no JavaScript router**. `/remote` is a real folder with its own `index.html`:

- Visiting `/remote` → GitHub Pages answers with a redirect to **`/remote/`** (trailing slash) and serves `remote/index.html`. Direct visits, refreshes and Back/Forward all work because it is a real page.
- This works the same on a user site (`https://name.github.io/`) and a **repository site** (`https://name.github.io/<repo>/remote/`). Pages find their assets through `<meta name="festverse-root">`, so no base path is hard-coded.
- `404.html` sends mistyped sub-paths such as `/remote/abc` back to `/remote/`.

**Limitation:** the address bar will show `/remote/` (with a trailing slash), and on a repository site the public URL includes the repo name (`/<repo>/` and `/<repo>/remote/`). Removing either needs a custom domain or a different host; it cannot be done by the site itself. `/#/remote` was *not* needed.

## 2. How the two pages communicate
1. Both pages join the Supabase Realtime **Broadcast** channel `fest-inauguration` and are announced to each other with **Presence** ("display online", "remote online"). The phone enables its button only after it is subscribed **and** the passcode is set.
2. Phone → confirm dialog → sends `inauguration_trigger` `{event_id, event_type, created_at, fest_name, message, sig}`. The send uses broadcast `ack`, so success is reported only when Supabase accepted it.
3. Display validates (type, id format, timestamp freshness, HMAC signature), de-duplicates by `event_id`, plays the animation, stores "inaugurated" in **its own** local storage, and replies with a `delivery_ack`.
4. Phone shows **INAUGURATION SIGNAL SENT** and "Display confirmed". No reply within 7 s → warning + **RESEND SIGNAL** (same `event_id`).
5. Other event types: `test_trigger` (labelled rehearsal animation, never official), `rehearsal_reset` (rehearsal only), `delivery_ack`.

Safeguards: a refresh or reconnect never replays the animation (the display shows the finished state if already inaugurated); old/replayed messages are rejected; a second official event is answered `already_inaugurated`; text on screen always comes from `js/config.js`, never from the network, and nothing is inserted with `innerHTML`. Delivery is **not guaranteed** — the confirmation + resend is the safety net, and the display itself has an emergency local start.

## 3. Deploy step by step (beginner friendly)
1. **Supabase:** follow `SUPABASE_SETUP.md`, then put the URL and publishable key into `js/config.js`. Set `fest.name` and the announcement texts.
2. **GitHub repository:** github.com → **+ → New repository** → any name (public) → **Create**. Click **uploading an existing file**, drag in **the contents** of the `festverse` folder (so `index.html` is at the top level — include the hidden `.nojekyll`; the zip contains it) → **Commit changes**.
3. **GitHub Pages:** repository → **Settings → Pages** → *Build and deployment*: Source **Deploy from a branch**, Branch **main**, folder **/ (root)** → **Save**. Wait 1–2 minutes; refresh until it shows *"Your site is live at …"*. That address is your **base URL**:
   - repo named `<username>.github.io` → `https://<username>.github.io/`
   - any other repo → `https://<username>.github.io/<repo>/`
4. **Display PC (Chrome):** open the base URL. A setup panel appears (it appears automatically when something is missing). Enter the **passcode**, press **Save**, click **Enable sound + fullscreen**, check *Connection: Connected*. Press **H** to hide the panel → screen is black.
5. **Phone:** open `<base URL>/remote/`, open **Control passcode**, enter the **same** passcode → **Save**.
6. **Both connected?** The phone shows green **Remote: connected** and **Display: ready**. The display setup panel (**S**) shows *Remotes online: 1*.
7. Run the rehearsal checklist below. Use **TEST ANIMATION** as often as you like.

Updating later: edit `js/config.js` on GitHub (pencil icon) → commit → wait ~1 min → hard refresh (Ctrl+Shift+R).

## 4. Customize (all in `js/config.js`)
| Setting | Where |
|---|---|
| Fest name | `fest.name` |
| Logo | replace `assets/images/logo.svg` or set `fest.logo` (png/svg/jpg). A missing file is hidden automatically |
| Announcement lines | `announcement.primary / secondary / subtitle` |
| Colours | `colors.*` |
| Duration | `animation.speed` (1 ≈ 8 s; 1.25 slower) |
| Particle amount | `animation.particles` (lower on a slow PC) |
| Sound | built-in synthesized swell + impact; or set `audio.file` to your own mp3 in `assets/audio/`; `audio.enabled: false` to mute |
| Passcode rules / freshness | `security.*` |
| New event / year | change `eventKey` (clears the "already inaugurated" memory for a fresh start) |

**Make it offline-proof (recommended):** download `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.98.0/dist/umd/supabase.js` once, save it as `js/vendor/supabase.js`, and put `'js/vendor/supabase.js'` as the **first** entry of `supabase.libUrls`. The library then no longer depends on a CDN.

## 5. Display controls
`S` setup panel · `H` hide · `F` or double-click fullscreen · `T` preview (panel open) · **Click the screen once** so Chrome allows sound. Open `/?setup=1` to force the panel. The cursor is hidden and the screen kept awake. **EMERGENCY: start here** in the setup panel starts the official animation from the PC itself (with a confirmation) if the internet fails.

## 6. Rehearsal and reset
- **TEST ANIMATION** (phone): shows a labelled "REHEARSAL" animation, fades to black, never records an inauguration.
- **Official trigger is final**: the phone button becomes **INAUGURATED** and disabled; refresh keeps it locked; the display ignores any second official event.
- **RESET FOR REHEARSAL**: not on the normal screen. Open `<base URL>/remote/?rehearsal=1`, tap it, type `RESET`. It is signed with the passcode (strangers cannot send it), returns the display to black and re-arms the phone. The old record is kept in the display's local history log, not silently erased. **Never use it at the real ceremony.**

## 7. Live event checklist
**Day before**
- [ ] Config filled in; site opens at the real URL on HTTPS; Supabase project is active (not paused)
- [ ] Display PC: Chrome, correct HDMI screen, Windows time set automatically, sound output = projector/speakers
- [ ] Phone clock set to automatic too (they must agree within 3 minutes)
- [ ] Passcode set on both devices (different networks are fine)
- [ ] Phone: green *connected* + *Display: ready*; display panel: *Remotes online: 1*
- [ ] **TEST ANIMATION** from the phone on the real projector at full volume; text readable from the back row
- [ ] Full rehearsal: confirm → inaugurate → display confirmed → refresh display (stays final, no replay) → `?rehearsal=1` reset
- [ ] Practise **RESEND** (airplane mode on the phone for 5 s, then back) and the **EMERGENCY** button once
- [ ] Optional: vendor the Supabase library locally (section 4)

**On the day (30 min before)**
- [ ] Reset after the last rehearsal; display shows *Waiting for the inauguration*
- [ ] Refresh both pages; reconnect; confirm green status
- [ ] Click the display once (sound unlocked: phone no longer says "sound locked"); press **F**, then **H**; screen is pure black
- [ ] Phone on charger, brightness up, mobile data/Wi-Fi checked, screen-lock set to never
- [ ] Display PC: sleep and screensaver off, notifications off (Do Not Disturb), only this tab open
- [ ] Backup: second person with the passcode and the base URL; PC keyboard ready for **S → EMERGENCY**

**Ceremony:** press **INAUGURATE FEST → CONFIRM** once. Wait for "Display confirmed". If it says no confirmation and the screen is still black, press **RESEND SIGNAL** (safe: plays once).

## 8. Troubleshooting
| Symptom | Fix |
|---|---|
| Display: "Not configured" | URL / key still placeholders in `js/config.js` (after committing, wait ~1 min and hard refresh) |
| "Cannot connect" | Realtime public access off, wrong URL/key, project paused, or Wi-Fi blocks WebSockets (try phone hotspot) |
| "Could not load the Supabase library" | CDN blocked → use the local `js/vendor/supabase.js` option |
| Phone: "Display: not detected" | Display page closed, different site URL, or no internet on the PC |
| Buttons disabled | Passcode missing, or not yet connected |
| "Display rejected the signal" / clock warning | Set PC and phone time to automatic |
| Reply/message "rejected", display ignores phone | Passcodes differ between devices |
| No sound | Click the display page once; check PC output device and `audio.volume` |
| Animation stutters | Lower `animation.particles`, close other tabs/apps, use Chrome |
| `/remote` shows 404 | Pages not yet built (wait), or files uploaded inside an extra folder — `index.html` must be at the repository root |
| Old version shows | Ctrl+Shift+R |

## 9. Test status — please read
Verified here: all JavaScript parses; the signing/validation logic passes 23 unit tests; the full browser flow (connect, reconnect, test animation, confirm dialog, double tap = one event, forged/stale/replayed events, refresh without replay, lost delivery + resend, send failure shown honestly, reset, `/my-repo/` base path, `/remote` redirect, 404 fallback, unconfigured state, library unreachable) passes in Chromium at 1920×1080 and 390×844.
**Not verified here:** a real Supabase project and the real CDN were not reachable from the build environment, so the browser tests ran against a stand-in that mimics the Broadcast/Presence calls (`channel.on`, `subscribe`, `send` with `ack`, `track`, `presenceState`). Do the rehearsal on your real project before the event — that is the one test only you can run.
