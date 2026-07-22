# Goldilocks

Goldilocks is a browser-only BAC planning, session-tracking, and breathalyzer-calibration app built for harm reduction. It is deployed as a zero-build static site on GitHub Pages.

Open the hosted app at [seeholmes.github.io/Goldilocks](https://seeholmes.github.io/Goldilocks/).

## Modes

- **Zone** (`goldilocks-zone.html`) builds an hourly plan intended to stay within a selected BAC range and replans from logged drinks.
- **Pace** (`goldilocks-cruise.html`) spaces drinks across a session toward a selected ending BAC, with session length selectable in 15-minute increments. The legacy filename is retained for bookmark compatibility.
- **Calibration** (`goldilocks-training.html`) records timed breathalyzer readings and saves a calibrated profile after a validated regression.

`index.html` is Mission Control and links to all three modes.

## Architecture

The production app has no framework, bundler, backend, analytics, or device integration. Each mode is a standalone HTML page with inline presentation and controller code. Shared, testable BAC and calibration calculations live in `goldilocks-core.js`; shared custom-drink validation and storage live in `goldilocks-presets.js`; shared theme behavior lives in `goldilocks-theme.js`; shared session-flow helpers and presentation live in `goldilocks-session-flow.js` and `goldilocks-session-flow.css`; and Mission Control reads resumable state through the non-mutating `goldilocks-session-state.js` inspector.

The only external runtime dependency is Google Fonts. User data stays in same-origin browser storage:

| Key | Purpose |
| --- | --- |
| `goldilocks_profiles` | Profiles shared by Calibration, Zone, and Pace |
| `goldilocks_theme` | Theme shared by all modes |
| `goldilocks_drinks` | Custom drinks shared by Zone and Pace |
| `goldilocks_v2_session` | Active Zone session |
| `goldilocks_cruise_session` | Active Pace session (legacy key retained for compatibility) |
| `goldilocks_training_session` | Active calibration |
| `goldilocks_training_history` | Last 20 completed calibration sessions |

Session records are validated and expire after their mode-specific recovery window. Zone keeps unresolved hourly logs distinct from an explicit zero, and both planners retain a finished-session summary before the record expires.

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

## Change boundaries

Changes to BAC math, schedule construction, calibration, profile shape, themes, or persistence must be checked across all affected modes. Add regression coverage for calculation changes before changing page behavior.

## Safety

BAC values are estimates, not measurements. A selected Zone range or Pace ending value is a planning preference, not a safety threshold. Food, hydration, medication, timing, physiology, and other factors can materially affect actual BAC. Use a breathalyzer where appropriate, never use this app to decide whether it is safe to drive, and never drive after drinking.
