# Goldilocks

Goldilocks is a browser-only BAC planning, session-tracking, and breathalyzer-calibration app built for harm reduction. It is deployed as a zero-build static site on GitHub Pages.

Open the hosted app at [seeholmes.github.io/Goldilocks](https://seeholmes.github.io/Goldilocks/).

## Modes

- **Zone** (`goldilocks-zone.html`) builds an hourly plan intended to stay within a selected BAC range and replans from logged drinks.
- **Pace** (`goldilocks-cruise.html`) spaces drinks across a session toward a selected ending BAC, with session length selectable in 15-minute increments. The legacy filename is retained for bookmark compatibility.
- **Grid** (`goldilocks-grid.html`) is a freeform exact-time drink log for mixed drinks, with current and highest modeled BAC, an optional warning-only personal BAC alert, editing, undo, recovery context, and session-end measurement evidence.
- **Calibration** (`goldilocks-training.html`) uses validated declining breathalyzer curves to calibrate elimination rate, summarizes measured-session evidence for BAC per standard drink, and exposes deliberate expert overrides.
- **History** (`goldilocks-history.html`) shows completed Zone, Pace, and Grid sessions stored on the current device, compares planned-model and session-implied BAC per standard drink, preserves exact Grid drink logs, and records optional measured BAC evidence and next-day recovery ratings.
- **Settings & Data** (`goldilocks-settings.html`) exports and restores a validated full-device JSON backup, summarizes retained data, and provides deliberate device-erasure controls.

`index.html` is Mission Control and links to all five modes plus Settings & Data.

## Architecture

The production app has no framework, bundler, backend, analytics, or device integration. Each mode is a standalone HTML page with inline presentation and controller code. Shared, testable BAC and calibration calculations live in `goldilocks-core.js`; exact-time Grid event calculations and validation live in `goldilocks-grid.js`; shared custom-drink validation and storage live in `goldilocks-presets.js`; shared theme behavior lives in `goldilocks-theme.js`; full-device export and transactional restore live in `goldilocks-backup.js`; shared session-flow helpers and presentation live in `goldilocks-session-flow.js` and `goldilocks-session-flow.css`; shared drink markers live in `goldilocks-drink-waypoint.js`; plan-review charts live in `goldilocks-trajectory.js` and `goldilocks-trajectory.css`; completed-session summaries are validated by `goldilocks-session-history.js`; and Mission Control reads resumable state through the non-mutating `goldilocks-session-state.js` inspector.

The only external runtime dependency is Google Fonts. User data stays in same-origin browser storage:

| Key | Purpose |
| --- | --- |
| `goldilocks_profiles` | Profiles shared by Calibration, Zone, Pace, and Grid |
| `goldilocks_theme` | Theme shared by all modes |
| `goldilocks_drinks` | Custom drinks shared by Zone, Pace, and Grid |
| `goldilocks_v2_session` | Active Zone session |
| `goldilocks_cruise_session` | Active Pace session (legacy key retained for compatibility) |
| `goldilocks_grid_session` | Active or recently completed Grid session and exact drink events |
| `goldilocks_training_session` | Active calibration |
| `goldilocks_training_history` | Up to 500 completed calibration sessions |
| `goldilocks_session_history` | Up to 1,000 completed Zone, Pace, and Grid session summaries |
| `goldilocks_last_backup_at` | Timestamp of the last successful backup export |
| `goldilocks_last_restore_at` | Timestamp of the last successful backup restore |

Session records are validated and expire after their mode-specific recovery window. Zone keeps unresolved hourly logs distinct from an explicit zero, the planners retain a finished-session summary before the resumable record expires, and Grid is bounded to 24 hours with up to 200 exact-time events. Every session requires a food-state context (`empty`, `light`, or `meal`); an optional protocol-confirmed breathalyzer reading and its timestamp can be attached at completion or later in History. Optional next-day recovery ratings are subjective context only. Ratings 3–4 can trigger conservative warnings in future planning and active sessions, but ratings never alter calibration or make plans more permissive.

Backups are portable, human-readable JSON files with a versioned schema. Restore validates the complete file before touching storage, replaces only Goldilocks-owned keys, and rolls back touched keys if a browser-storage write fails. Backup files are not encrypted and can contain private body-profile, BAC, and session information.

## Local development

Serve the repository with any static HTTP server, then open `index.html`. For example:

```powershell
python -m http.server 8000
```

Run the dependency-free regression suite with:

```powershell
npm test
```

There is no production build command; deployment publishes the repository files as-is.

## Releases

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Change boundaries

Changes to BAC math, schedule construction, calibration, profile shape, themes, or persistence must be checked across all affected modes. Add regression coverage for calculation changes before changing page behavior.

## Safety

BAC values are estimates, not measurements. A selected Zone range, Pace ending value, or Grid alert is a personal planning or notification preference—not a safety threshold. Food, hydration, medication, timing, physiology, and other factors can materially affect actual BAC. Use a breathalyzer where appropriate, never use this app to decide whether it is safe to drive, and never drive after drinking.
