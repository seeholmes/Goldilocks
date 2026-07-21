# Goldilocks

Goldilocks is a browser-only BAC planning, session-tracking, and breathalyzer-calibration app built for harm reduction. It is deployed as a zero-build static site on GitHub Pages.

Open the hosted app at [seeholmes.github.io/Goldilocks](https://seeholmes.github.io/Goldilocks/).

## Modes

- **Zone** (`goldilocks-zone.html`) builds an hourly plan intended to stay within a selected BAC range and replans from logged drinks.
- **Cruise** (`goldilocks-cruise.html`) spaces drinks across a session toward a selected ending BAC.
- **Training** (`goldilocks-training.html`) records timed breathalyzer readings and saves a calibrated profile after a validated regression.

`index.html` is Mission Control and links to all three modes.

## Architecture

The production app has no framework, bundler, backend, analytics, or device integration. Each mode is a standalone HTML page with inline presentation and controller code. Shared, testable BAC and calibration calculations live in `goldilocks-core.js`.

The only external runtime dependency is Google Fonts. User data stays in same-origin browser storage:

| Key | Purpose |
| --- | --- |
| `goldilocks_profiles` | Profiles shared by Training, Zone, and Cruise |
| `goldilocks_theme` | Theme shared by all modes |
| `goldilocks_drinks` | Zone custom drinks |
| `goldilocks_v2_session` | Active Zone session |
| `goldilocks_cruise_session` | Active Cruise session |
| `goldilocks_training_session` | Active Training protocol |
| `goldilocks_training_history` | Last 20 completed training sessions |

Session records are validated and expire after their mode-specific recovery window.

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

BAC values are estimates, not measurements. Food, hydration, medication, timing, physiology, and other factors can materially affect actual BAC. Use a breathalyzer where appropriate, never use this app to decide whether it is safe to drive, and never drive after drinking.
