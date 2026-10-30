// ============================================================================
//  FestVerse configuration  —  the ONLY file you normally need to edit.
//  Everything here is PUBLIC (it ships to the browser). Never put a Supabase
//  service_role key or secret key in this file.
// ============================================================================

export const CONFIG = {
  // --- Supabase ------------------------------------------------------------
  supabase: {
    // Project Settings > API (or the "Connect" dialog) in the Supabase dashboard.
    url: 'https://iwotnbgcxwlfacgktuyi.supabase.co',
    // The PUBLISHABLE key (sb_publishable_...) or the legacy "anon" key.
    // Both are designed to be public. NEVER use a secret / service_role key.
    publishableKey: 'sb_publishable_twtV4o4IYA8qcfWnNVpfEA_fZX2HFDJ',

    // The Supabase client library, pinned to an exact version (never "latest").
    // They are tried in order; the first one that loads wins.
    // For maximum reliability on the day, download the file once into
    // js/vendor/supabase.js (see README) and put 'js/vendor/supabase.js' FIRST.
    libUrls: [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.98.0/dist/umd/supabase.js',
      'https://unpkg.com/@supabase/supabase-js@2.98.0/dist/umd/supabase.js',
    ],
    // Last-resort ES-module fallback, same pinned version.
    esmUrl: 'https://esm.sh/@supabase/supabase-js@2.98.0',
  },

  // --- Communication -------------------------------------------------------
  channelName: 'fest-inauguration', // Realtime Broadcast channel (both pages must match)
  // Namespaces what is stored in each device's localStorage. Change it for a new
  // event/year so an old "already inaugurated" record can never leak across events.
  eventKey: 'festverse-2026',

  // --- Branding ------------------------------------------------------------
  fest: {
    name: 'ANVAYA 2k26', // replace with the real fest name
    logo: 'assets/images/logo.svg', // path relative to the site root; a missing file is fine
  },

  announcement: {
    primary: 'THE FEST IS OFFICIALLY INAUGURATED',
    secondary: 'LET THE FEST BEGIN!',
    subtitle: 'A celebration of talent, innovation and creativity.', // '' to hide
  },

  colors: {
    gold: '#d4af37',
    goldLight: '#f6e27a',
    goldDeep: '#9a7420',
    amber: '#ffb347',
    text: '#f5f1e6',
  },

  // --- Display animation ---------------------------------------------------
  animation: {
    speed: 1, // 1 = about 8 seconds. 1.25 = slower / longer, 0.8 = faster.
    particles: 160, // size of the golden burst; lower it (e.g. 80) for a weak PC
    testHoldSeconds: 6, // how long a TEST animation stays before fading back to black
    revealAt: 32,
    testRevealAt: null,
  },

  audio: {
    enabled: true,
    // '' = built-in synthesized cinematic sound (no file needed).
    // Or set e.g. 'assets/audio/inauguration.mp3' to use your own file.
    file: 'assets/audio/audio.mp3',
    volume: 0.85, // 0 – 1
  },

  // --- Security / reliability ---------------------------------------------
  security: {
    // Every message is signed with a passcode that is typed on the phone and on
    // the display PC. It is NOT stored in this file (this file is public).
    requirePasscode: true,
    minPasscodeLength: 8,
    // Messages older / newer than this (by the receiving device's clock) are ignored.
    maxEventAgeSeconds: 180,
  },

  remote: {
    ackTimeoutMs: 7000, // how long the remote waits for the display's confirmation
  },
};
