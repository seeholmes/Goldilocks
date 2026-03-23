GOLDILOCKS — RELEASE NOTES
Version 1.00
March 2026
──────────────────────────────────────────────────────────────────

OVERVIEW
────────
Goldilocks is a personal BAC planning and session tracking web app
with a companion calibration tool. Designed for harm reduction —
not too much, not too little, just right.

Hosted at: seeholmes.github.io/Goldilocks/goldilocks-zone.html
Training:  seeholmes.github.io/Goldilocks/goldilocks-training.html


APPS
────
Two companion apps sharing a common design language and localStorage:

  Goldilocks (goldilocks-zone.html)
    Plan and track a drinking session in real time. Estimates BAC
    using a calibrated personal profile or Widmark formula.

  Goldilocks Training (goldilocks-training.html)
    A timed breathalyzer calibration protocol. Derives personal
    elimination rate and rise rate from real readings. Saves
    calibrated profile data back to Goldilocks automatically.


CORE FEATURES
─────────────
  · BAC planning engine
    Builds an hourly drink schedule to keep BAC within a target
    zone (default 0.04–0.08). Whole drinks only, front-loaded to
    reach the zone as early as possible.

  · Session tracking
    Launch a session to log actual drinks per hour. BAC estimated
    live every 10 seconds. Replans future hours automatically if
    you drink more than planned.

  · Profile system
    Hardcoded seeholmes profile (calibrated constants). Custom
    Widmark profile (weight/sex). Save any custom profile by name
    — persists to localStorage and appears in dropdown.

  · Calibration training protocol
    T+0    Drink 1 standard drink
    T+45   Reading 1 (absorption complete)
    T+65   Reading 2
    T+85   Reading 3 (protocol complete)
    T+105  Optional 4th reading for improved confidence
    Linear regression fits elimination curve. R² confidence
    scoring. Fasted sessions record elimination only; rise rate
    excluded from average. Multi-session averaging with low /
    medium / high confidence levels.

  · Shared localStorage architecture
    goldilocks_profiles  — calibrated profile data (both apps)
    goldilocks_theme     — color theme (both apps)
    goldilocks_drinks    — saved custom drinks (main app)
    goldilocks_v2_session — active session state (main app)

  · Six color themes
    Cosmos, Navy, Espresso, Parchment, Honey, Slate.
    Selected via circular swatches in the hero. Persists across
    both apps via shared localStorage key.

  · Orbital summary widget
    Two-arc ring: wide dim arc = session time elapsed, thin bright
    arc = current/peak BAC. Arc color shifts blue → gold → amber
    → red through the zone. Large planet orb displays drink count.

  · In-zone hour badges
    Completed hours show ⭐ if BAC was in zone, 💧 if not.

  · Save custom drinks
    Name and save any oz/ABV combination. Appears under My Drinks
    in the Quick Select dropdown. Deletable via trash icon.

  · Delete profiles and drinks
    Trash icon appears next to dropdown when a user-saved item is
    selected. Built-in profiles (seeholmes, Custom) cannot be
    deleted.

  · Android home screen icon support
    manifest.json and manifest-training.json added for both apps.
    Enables correct icon display when added to home screen on
    Android/Chrome in addition to iOS/Safari.

  · Session resilience
    Session state saved to localStorage on every action. Restored
    automatically on page reload or tab refocus. Unlogged hours
    filled with zero drinks (not plan) on transition. Session
    expires 1 hour after planned end time.


BUG FIXES (pre-release)
────────────────────────
  · Fixed BAC climbing overnight — unlogged hours were being
    filled with planned drink counts instead of zero, causing BAC
    to accumulate through sleep.

  · Fixed BAC/std drink chip inflating when a non-standard drink
    was configured — chip now always displays BAC per one standard
    drink regardless of configured drink size.

  · Fixed BAC override causing tracking to freeze after manual
    correction — feature removed entirely in favour of profile
    calibration as the accuracy mechanism.

  · Fixed syntax error caused by missing function declaration
    after patch to updateWidmarkChip.

  · Fixed session expiry window tightened from hours+2 to hours+1
    to reduce stale session restoration risk.


KNOWN LIMITATIONS
─────────────────
  · BAC estimates are model-based and vary with food, hydration,
    medication, and individual tolerance. Always use alongside
    a breathalyzer, not instead of one.

  · iOS home screen icon may show stale cache for existing users
    after an icon update. Remove and re-add shortcut to refresh.

  · Training app icon (apple-touch-icon-training.png) is a
    placeholder flask design — to be replaced with final artwork.

  · Widmark formula used for uncalibrated profiles. Run training
    sessions for personal accuracy.


NEVER DRIVE AFTER DRINKING.
For harm reduction only.
──────────────────────────────────────────────────────────────────
