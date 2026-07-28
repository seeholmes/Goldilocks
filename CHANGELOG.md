# Changelog

All notable user-facing changes to Goldilocks are documented here.

## [Unreleased]

### Added

- Added Grid, a freeform “any drink, any time” session mode with mixed-drink presets, exact and backdated timestamps, current and highest modeled BAC, an optional warning-only personal BAC alert, edit/delete/undo, explicit finish, and Mission Control recovery.
- Added completed Grid sessions to History with exact per-drink logs, model-versus-measurement evidence, and next-day recovery ratings and warnings.
- Included active Grid sessions and completed Grid history in full-device JSON backups.
- Added a projected BAC trajectory to the Zone and Pace plan reviews, with planned drink timing shown separately from the period-end model estimates.
- Added shared user selection, creation, and deletion to Calibration, with body settings and calibration results synchronized across all modules.
- Added required food-state context to planner and calibration sessions, plus optional timestamped, protocol-confirmed breathalyzer readings on completed planner sessions.
- Added session-evidence summaries and expert BAC-per-standard-drink controls to Calibration, including suggestion, manual override, and baseline reset actions.
- Added a side-by-side planned-model versus session-implied BAC-per-standard-drink comparison to History.
- Added optional next-day recovery ratings to historical sessions, with personal warnings when a plan or active session meets or exceeds a prior Apollo 13 or Event Horizon outcome.
- Added Settings & Data with complete JSON export, mobile file sharing, validated restore preview, transactional replacement, and deliberate full-device erasure.
- Added a persistent Settings & Data shortcut across Mission Control, Zone, Pace, Grid, Calibration, and History.

### Changed

- Replaced the shared ringed-planet drink marker with a native bear emoji, including a clear outline after a drink is logged.
- Combined duration, Zone range or Pace ending reference, projection, metrics, and Start into a single Plan Tuner card in both planners.
- Calibration now treats declining readings as the source of elimination-rate calibration. Observed rising BAC remains evidence, and eligible historical measurements produce suggestions that are never applied automatically.
- Next-day recovery ratings remain subjective context: they can produce conservative warnings but never alter calibration or make plans more permissive.
- Increased retained planner history from 50 to 1,000 sessions and Calibration history from 20 to 500 sessions so backups preserve a much longer record.

### Fixed

- Restored custom-profile saving and deletion directly in Pace so shared profiles can be managed from either planner.
- Prevented Zone and Pace from replacing an existing calibrated user with a new Widmark-only profile.

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
