# Changelog

All notable user-facing changes to Goldilocks are documented here.

## [Unreleased]

### Added

- Added a projected BAC trajectory to the Zone and Pace plan reviews, with planned drink timing shown separately from the period-end model estimates.

### Changed

- Replaced the shared ringed-planet drink marker with a native bear emoji, including a clear outline after a drink is logged.

## [1.1.0] - 2026-07-22

### Added

- Added Calibration for creating a shared personal BAC model from timed breathalyzer readings.
- Added local History for the latest 50 completed Zone and Pace sessions, with mode filters and deletion controls.
- Added shared custom drink presets across Zone and Pace.
- Added 15-minute session-duration planning in both Zone and Pace.
- Added resumable session states, explicit finish and discard flows, undo controls, and editable logs.
- Added a shared theme system and the Goldilocks astronaut visual identity.

### Changed

- Renamed Cruise to Pace and Training to Calibration while retaining legacy filenames and storage keys for compatibility.
- Standardized drink actions and timeline markers with a shared ringed-planet waypoint.
- Simplified Zone by removing beer icons and score-like gamification visuals.
- Zone and Pace now start when the user clicks Start instead of requiring a planned start time.
- Improved Pace replanning so early drink logs preserve cadence and do not indefinitely compress or extend the plan.

### Fixed

- Fixed Pace target times shifting backward after an early drink log.
- Fixed completed drinks failing to reduce the remaining Pace schedule.
- Fixed partial-hour session calculations and session-resolution inconsistencies across both planners.
- Hardened stored session validation, recovery, and completion summaries.

[1.1.0]: https://github.com/seeholmes/Goldilocks/tree/v1.1.0
