'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pages = [
  'index.html',
  'goldilocks-zone.html',
  'goldilocks-cruise.html',
  'goldilocks-training.html',
  'goldilocks-history.html',
];
const modePages = [
  'goldilocks-zone.html',
  'goldilocks-cruise.html',
  'goldilocks-training.html',
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('package and page version labels stay synchronized', () => {
  const packageVersion = JSON.parse(read('package.json')).version;
  assert.equal(packageVersion, '1.1.0');
  for (const page of pages) {
    const escapedVersion = packageVersion.replace(/\./g, '\\.');
    assert.match(read(page), new RegExp(`v${escapedVersion}\\b`), `${page} must show v${packageVersion}`);
  }
});

function openingTagWithId(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`<[^>]+\\bid="${escaped}"[^>]*>`, 'i'))?.[0] || '';
}

function functionSource(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{`).exec(html);
  if (!match) return '';
  let depth = 1;
  for (let index = match.index + match[0].length; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') depth -= 1;
    if (depth === 0) return html.slice(match.index, index + 1);
  }
  return '';
}

function pngDimensions(relativePath) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG', `${relativePath} must be a PNG`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test('all inline scripts compile', () => {
  for (const page of pages) {
    const html = read(page);
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const [index, match] of scripts.entries()) {
      assert.doesNotThrow(
        () => new Function(match[1]),
        `${page} inline script ${index + 1} must compile`
      );
    }
  }
});

test('documents have unique IDs and valid local references', () => {
  for (const page of pages) {
    const html = read(page);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${page} must not contain duplicate IDs`);

    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const reference = match[1];
      if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) continue;
      const target = reference.split(/[?#]/, 1)[0];
      if (!target) continue;
      assert.ok(
        fs.existsSync(path.resolve(root, target)),
        `${page} references missing local file ${reference}`
      );
    }
  }
});

test('mode pages load the tested calculation core', () => {
  const requiredCalls = {
    'goldilocks-zone.html': [
      'bacPerDrink', 'simulateDuration', 'estimateLiveBac', 'buildZoneSchedule', 'widmarkRisePerStd',
    ],
    'goldilocks-cruise.html': [
      'bacPerDrink', 'simulateDuration', 'estimateLiveBac',
      'buildCruiseReplan',
    ],
    'goldilocks-training.html': [
      'calculateCalibration', 'fitLine', 'widmarkRisePerStd',
    ],
  };
  for (const page of modePages) {
    const html = read(page);
    assert.match(
      html,
      /<script\s+src="goldilocks-core\.js(?:\?[^\"]+)?"\s*><\/script>/i,
      `${page} must load goldilocks-core.js`
    );
    for (const method of requiredCalls[page]) {
      assert.match(
        html,
        new RegExp(`GoldilocksCore\\.${method}\\s*\\(`),
        `${page} must use GoldilocksCore.${method}`
      );
    }
  }
});

test('Zone and Pace use the shared custom-drink store', () => {
  for (const page of ['goldilocks-zone.html', 'goldilocks-cruise.html']) {
    const html = read(page);
    assert.match(
      html,
      /<script\s+src="goldilocks-presets\.js"\s*><\/script>/i,
      `${page} must load goldilocks-presets.js`
    );
    assert.match(html, /GoldilocksPresets\.STORAGE_KEY/);
    assert.match(html, /GoldilocksPresets\.read\s*\(/);
    assert.match(html, /id="myDrinksGroup"/);
    assert.match(html, /startsWith\('custom:'\)/);
  }
});

test('Pace exposes 15-minute session-length planning', () => {
  const html = read('goldilocks-cruise.html');
  const durationInput = html.match(/<input\b[^>]*\bid="duration"[^>]*>/i)?.[0] || '';
  assert.match(durationInput, /\bmin="60"/i);
  assert.match(durationInput, /\bmax="480"/i);
  assert.match(durationInput, /\bstep="15"/i);
  assert.match(html, /durationMinutes/);
  assert.match(html, /formatDuration\s*\(/);
  assert.match(html, /normalizeRestoredSession\s*\(/);
  assert.match(html, /s\.hours\s*\*\s*60/);
  assert.match(html, /s\.plan\.length\s*!==\s*bucketCount/);
});

test('Zone exposes 15-minute session-length planning and migrates whole-hour sessions', () => {
  const html = read('goldilocks-zone.html');
  const durationInput = openingTagWithId(html, 'duration');
  assert.match(durationInput, /\bmin="60"/i);
  assert.match(durationInput, /\bmax="480"/i);
  assert.match(durationInput, /\bstep="15"/i);
  assert.match(html, /durationMinutes/);
  assert.match(html, /getDurationBucketCount\s*\(/);
  assert.match(html, /formatDuration\s*\(/);

  const normalize = functionSource(html, 'normalizeRestoredSession');
  assert.ok(normalize, 'Zone must normalize legacy whole-hour saved sessions');
  assert.match(normalize, /s\.hours\s*\*\s*60/);

  const restoredValidation = functionSource(html, 'isValidRestoredSession');
  assert.match(restoredValidation, /bucketCount/);
  assert.match(restoredValidation, /s\.plan\.length\s*!==\s*bucketCount/);

  const inspectZone = functionSource(read('goldilocks-session-state.js'), 'inspectZone');
  assert.match(inspectZone, /durationMinutes/);
  assert.match(inspectZone, /session\.hours\s*\*\s*60/);
  assert.match(inspectZone, /bucketCount/);
});

test('Zone starts when Start is clicked and exposes no planned start-time control', () => {
  const html = read('goldilocks-zone.html');
  assert.equal(openingTagWithId(html, 'startTime'), '', 'Zone must not render a planned start-time field');
  assert.doesNotMatch(html, /\bfor="startTime"/i, 'Zone must not retain a label for a removed start-time field');
  assert.doesNotMatch(
    html,
    /(?:getElementById\(\s*['"]startTime['"]|querySelector(?:All)?\(\s*['"]#startTime['"])/,
    'Zone must not read a removed start-time field from the DOM'
  );

  const startSession = functionSource(html, 'startSession');
  assert.match(startSession, /sessionStartTs\s*=/);
  assert.match(startSession, /Date\.now\(\)/, 'Zone must anchor the session to the Start click');
  assert.doesNotMatch(startSession, /configuredStart|getStart\(\)\.getTime\(\)/);
  assert.match(html, /Timing starts immediately when you (?:tap|click) Start/i);
  assert.match(html, /times? (?:below )?(?:are|is) a live preview/i);
});

test('Zone models and clamps a partial final hourly bucket', () => {
  const html = read('goldilocks-zone.html');
  const simulate = functionSource(html, 'simulate');
  assert.match(simulate, /GoldilocksCore\.simulateDuration\s*\(/);
  assert.match(simulate, /getDurationHours\s*\(/);

  const timeline = functionSource(html, 'renderTimeline');
  assert.match(
    timeline,
    /Math\.min\(\s*(?:h\s*\+\s*1|getDurationHours\(\))\s*,\s*(?:getDurationHours\(\)|h\s*\+\s*1)\s*\)/,
    'Zone must clamp the final timeline block to the exact fractional session end'
  );
  assert.match(
    timeline,
    /fmt\(\s*start\s*,\s*(?:Math\.min\(|(?:bucket|period|block)End\w*)/,
    'Zone must render the clamped final timeline end instead of a full extra hour'
  );

  const refreshPreview = functionSource(html, 'refreshPlanningPreview');
  assert.match(refreshPreview, /plan\.length\s*!==\s*getDurationBucketCount\(\)/);

  const unresolved = functionSource(html, 'getUnresolvedElapsedHours');
  assert.match(unresolved, /elapsedMs\s*%\s*3600000\s*===\s*0/);

  const requestFinish = functionSource(html, 'requestFinishSession');
  assert.match(requestFinish, /Confirm \$\{getPeriodLabel\(unresolvedHours\[0\]\)\}/);
});

test('Zone and Pace load the shared Phase 2 session-flow assets', () => {
  for (const page of ['goldilocks-zone.html', 'goldilocks-cruise.html']) {
    const html = read(page);
    assert.match(
      html,
      /<link\b[^>]*\bhref="goldilocks-session-flow\.css"[^>]*>/i,
      `${page} must load goldilocks-session-flow.css`
    );
    assert.match(
      html,
      /<script\b[^>]*\bsrc="goldilocks-session-flow\.js(?:\?[^\"]+)?"[^>]*><\/script>/i,
      `${page} must load goldilocks-session-flow.js`
    );
  }
  assert.match(
    read('goldilocks-session-flow.css'),
    /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/i,
    'shared flow styles must keep completed/planning regions semantically hidden'
  );
});

test('Zone and Pace expose an accessible planning, active, and completion flow', () => {
  const requiredIds = [
    'setupFlow',
    'preStartReview',
    'activeSessionPanel',
    'nextAction',
    'nextActionTimer',
    'finishSessionBtn',
    'discardSessionBtn',
    'sessionSummary',
    'sessionSummaryHeading',
  ];

  for (const page of ['goldilocks-zone.html', 'goldilocks-cruise.html']) {
    const html = read(page);
    for (const id of requiredIds) {
      assert.ok(openingTagWithId(html, id), `${page} must expose #${id}`);
    }

    assert.match(openingTagWithId(html, 'preStartReview'), /\baria-labelledby="[^"]+"/i);
    assert.match(openingTagWithId(html, 'activeSessionPanel'), /\baria-labelledby="[^"]+"/i);
    assert.match(openingTagWithId(html, 'sessionSummary'), /\baria-labelledby="sessionSummaryHeading"/i);

    const nextAction = openingTagWithId(html, 'nextAction');
    const nextActionText = openingTagWithId(html, 'nextActionText') || openingTagWithId(html, 'nextActionTitle');
    const liveStatus = /\brole="status"/i.test(nextAction) ? nextAction : nextActionText;
    assert.match(liveStatus, /\brole="status"/i, `${page} next action must expose a status`);
    assert.match(liveStatus, /\baria-live="polite"/i, `${page} next action must announce meaningful changes politely`);

    const timer = openingTagWithId(html, 'nextActionTimer');
    assert.match(timer, /\brole="timer"/i, `${page} countdown must expose timer semantics`);
    const timerLiveSetting = timer.match(/\baria-live="([^"]+)"/i)?.[1]?.toLowerCase();
    assert.equal(timerLiveSetting, 'off', `${page} countdown must not announce every timer update`);

    for (const id of ['finishSessionBtn', 'discardSessionBtn']) {
      assert.match(openingTagWithId(html, id), /\btype="button"/i, `${page}#${id} must be an explicit button`);
    }
    assert.match(openingTagWithId(html, 'sessionSummaryHeading'), /\btabindex="-1"/i);
    assert.match(
      html,
      /getElementById\(['"]sessionSummaryHeading['"]\)\.focus(?:\?\.)?\s*\(/,
      `${page} must move focus to its completion summary`
    );
  }
});

test('Zone and Pace keep every live tuning control with the projected trajectory', () => {
  const planners = {
    'goldilocks-zone.html': ['bacMin', 'bacMax'],
    'goldilocks-cruise.html': ['bacEnd'],
  };

  for (const [page, modeControlIds] of Object.entries(planners)) {
    const html = read(page);
    const tunerStart = html.indexOf('id="preStartReview"');
    const tunerEnd = html.indexOf('id="activeSessionPanel"');
    assert.ok(tunerStart >= 0 && tunerEnd > tunerStart, `${page} must place its tuner before the active session`);
    const tuner = html.slice(tunerStart, tunerEnd);

    for (const id of ['duration', 'reviewTrajectory', 'startBtn', ...modeControlIds]) {
      assert.match(tuner, new RegExp(`\\bid="${id}"`), `${page}#${id} must live inside the plan tuner`);
    }
    assert.ok(tuner.indexOf('id="duration"') < tuner.indexOf('id="reviewTrajectory"'));
    assert.ok(tuner.indexOf('id="reviewTrajectory"') < tuner.indexOf('id="startBtn"'));
  }
});

test('Zone and Pace provide distinct finish, discard, undo, edit, and reconciliation paths', () => {
  const planners = {
    'goldilocks-zone.html': {
      functions: ['finishSession', 'discardSession', 'undoLastLog', 'setHourLog', 'renderReconcileEditor'],
      sharedCalls: ['zoneUnresolvedHours', 'elapsedMinutes'],
      confirmation: 'openSessionDialog',
      reset: 'resetToPlanning',
    },
    'goldilocks-cruise.html': {
      functions: ['finishSession', 'discardSession', 'undoLatestDrink', 'editLoggedDrink', 'recalcFromNow'],
      sharedCalls: ['paceNextIndex', 'validatePaceTimestamp', 'describeDeadline'],
      confirmation: 'requestSessionAction',
      reset: 'resetSessionToPlanning',
    },
  };

  for (const [page, contract] of Object.entries(planners)) {
    const html = read(page);
    for (const name of contract.functions) {
      assert.ok(functionSource(html, name), `${page} must define ${name}()`);
    }
    for (const name of contract.sharedCalls) {
      assert.match(html, new RegExp(`GoldilocksSessionFlow\\.${name}\\s*\\(`), `${page} must use ${name}()`);
    }

    const finish = functionSource(html, 'finishSession');
    const discard = functionSource(html, 'discardSession');
    const destructiveReset = functionSource(html, contract.reset);
    const confirmation = functionSource(html, contract.confirmation);
    assert.doesNotMatch(finish, /clearSavedSession\s*\(/, `${page} finish must preserve its saved summary`);
    assert.match(
      `${discard}\n${destructiveReset}`,
      /clearSavedSession\s*\(/,
      `${page} discard must clear the saved session`
    );
    assert.match(confirmation, /(?:showModal|confirm)\s*\(/, `${page} destructive actions must request confirmation`);
  }

  const zoneUndo = functionSource(read('goldilocks-zone.html'), 'undoLastLog');
  assert.match(zoneUndo, /change\.previousPlan/, 'Zone undo must restore the exact prior plan');
  assert.match(zoneUndo, /change\.previousReplanFlags/, 'Zone undo must restore prior replan markers');

  const paceRecalc = functionSource(read('goldilocks-cruise.html'), 'recalcFromNow');
  assert.match(
    paceRecalc,
    /GoldilocksSessionFlow\.paceReconcileSchedule\s*\(/,
    'Pace must reconcile the active slot schedule without recreating it'
  );
  assert.match(
    paceRecalc,
    /sessionCadenceHours\s*\*\s*3600000/,
    'Pace must preserve its immutable session cadence'
  );
  assert.match(
    paceRecalc,
    /paceReconcileSchedule\(\s*drinkSchedule\s*,\s*actualDrinkTimes\s*,/,
    'normal Pace reconciliation must start from the current schedule'
  );
  assert.doesNotMatch(paceRecalc, /buildCruiseReplan\s*\(/, 'active Pace logs must not recreate drinks to chase the endpoint reference');
  assert.doesNotMatch(paceRecalc, /planSpacing\s*=/, 'active Pace reconciliation must not rewrite the displayed cadence');

  const paceUndo = functionSource(read('goldilocks-cruise.html'), 'undoLatestDrink');
  assert.match(
    paceUndo,
    /drinkSchedule\s*=\s*change\.drinkSchedule\.slice\(\)/,
    'Pace Undo must restore the exact schedule from before the latest log'
  );
  assert.match(paceUndo, /lastPaceLogChange\s*=\s*null/, 'Pace must provide one-step Undo without replaying older changes');

  const paceOverdue = functionSource(read('goldilocks-cruise.html'), 'recalculateScheduleFromNow');
  assert.match(paceOverdue, /recalcFromNow\(\{\s*fromAt:\s*Date\.now\(\)\s*\}\)/, 'only explicit overdue recalculation may advance the next slot to now');
});

test('planner BAC copy does not present a selected target as safe or nudge consumption', () => {
  for (const page of ['goldilocks-zone.html', 'goldilocks-cruise.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /In the Goldilocks Zone/i, `${page} must not label a selected range as safe`);
    assert.doesNotMatch(html, /\bOn target\b/i, `${page} must not present a BAC goal as a success state`);
    assert.doesNotMatch(
      html,
      /Below (?:selected )?(?:range|goal|target|zone)[^'"\n<]*(?:reassess|speed up|drink)/i,
      `${page} must not nudge drinking when below a selected target`
    );
    assert.match(html, /not a safety threshold/i, `${page} must distinguish planning targets from safety`);
  }

  const zone = read('goldilocks-zone.html');
  assert.doesNotMatch(zone, /\bSober\b|\.in-zone|bacMax\s*\*\s*1\./i, 'Zone visuals must not turn a preference into a safety scale');
  assert.match(zone, /BAC_DISPLAY_SCALE/, 'Zone must use a fixed estimate display scale');

  const pace = read('goldilocks-cruise.html');
  assert.doesNotMatch(pace, /Session Goal|Choose different session settings/i, 'Pace must not frame its reference as a goal to reach');
});

test('planner fasted controls disclose that they are advisory only', () => {
  for (const page of ['goldilocks-zone.html', 'goldilocks-cruise.html']) {
    const html = read(page);
    const toggle = openingTagWithId(html, 'fastedToggle');
    assert.match(toggle, /\baria-pressed="false"/i, `${page} fasted control must expose toggle state`);
    const warningStart = html.indexOf('id="fastedWarning"');
    assert.ok(warningStart >= 0, `${page} must expose #fastedWarning`);
    const warning = html.slice(warningStart, warningStart + 700);
    assert.match(warning, /Advisory only/i, `${page} must call the fasted setting advisory`);
    assert.match(warning, /does not (?:change|alter)/i, `${page} must disclose that the model is unchanged`);
    assert.match(warning, /\b(?:BAC )?estimate\b/i, `${page} must mention the estimate is unchanged`);
    assert.match(warning, /\bplan\b/i, `${page} must mention the plan is unchanged`);
  }
});

test('all pages use the shared theme catalog and animated icon system', () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(
      html,
      /<script\s+src="goldilocks-theme\.js"\s*><\/script>/i,
      `${page} must load goldilocks-theme.js`
    );
    assert.match(
      html,
      /<link\s+rel="stylesheet"\s+href="goldilocks-icons\.css">/i,
      `${page} must load goldilocks-icons.css`
    );
    assert.match(html, /id="themePicker"/i, `${page} must expose the shared theme picker`);
    assert.doesNotMatch(html, /\bconst\s+THEMES\s*=/, `${page} must not duplicate the theme catalog`);
  }

  const iconCss = read('goldilocks-icons.css');
  assert.match(iconCss, /glyph-orbit/);
  assert.match(iconCss, /glyph-step/);
  assert.match(iconCss, /glyph-rise/);
  assert.match(iconCss, /prefers-reduced-motion\s*:\s*reduce/i);

  const expectedIcons = {
    'goldilocks-zone.html': 'mode-glyph--zone',
    'goldilocks-cruise.html': 'mode-glyph--pace',
    'goldilocks-training.html': 'mode-glyph--training',
    'goldilocks-history.html': 'mode-glyph--history',
  };
  for (const [page, className] of Object.entries(expectedIcons)) {
    assert.match(read(page), new RegExp(className));
  }
});

test('Mission Control exposes shared local Zone and Pace history', () => {
  const landing = read('index.html');
  const historyPage = read('goldilocks-history.html');
  assert.match(landing, /href="goldilocks-history\.html"/);
  assert.match(landing, /<h3 class="mode-name">History<\/h3>/);
  assert.match(landing, /<script src="goldilocks-session-history\.js"><\/script>/);
  assert.match(landing, /GoldilocksSessionHistory\.read\(localStorage\)/);
  assert.match(historyPage, /GoldilocksSessionHistory\.read\(localStorage\)/);
  assert.match(historyPage, /GoldilocksSessionHistory\.remove\(localStorage, record\.id\)/);
  assert.match(historyPage, /GoldilocksSessionHistory\.clear\(localStorage\)/);
  assert.match(historyPage, /\bconfirm\s*\(/, 'history deletion must require confirmation');

  for (const page of ['goldilocks-zone.html', 'goldilocks-cruise.html']) {
    const html = read(page);
    assert.match(html, /<script src="goldilocks-session-history\.js"><\/script>/);
    assert.match(html, /GoldilocksSessionHistory\.save\(localStorage,/);
    assert.match(html, /id:\s*`(?:zone|pace)-\$\{sessionStartTs\}`/);
  }
});

test('Zone and Pace share the native bear drink control without gamified drink rewards', () => {
  const zone = read('goldilocks-zone.html');
  const pace = read('goldilocks-cruise.html');
  for (const html of [zone, pace]) {
    assert.match(html, /<script src="goldilocks-drink-waypoint\.js"><\/script>/);
    assert.match(html, /class="session-action-btn primary drink-log-action"/);
    assert.match(html, /GoldilocksDrinkWaypoint\.decorateButton\(/);
  }
  assert.match(zone, /GoldilocksDrinkWaypoint\.create\(document, waypointState\)/);
  assert.match(pace, /GoldilocksDrinkWaypoint\.create\(document, waypointState\)/);
  assert.doesNotMatch(zone, /🍺|orbit-summary|orbit-svg-wrap|orbit-big|peakArc|timeArc/);
  assert.doesNotMatch(pace, /dte-dot|dotPulse/);
  assert.doesNotMatch(`${zone}\n${pace}`, /troph|achievement|streak|reward|confetti/i);
});

test('Zone and Pace review the plan with the shared period-end trajectory', () => {
  for (const page of ['goldilocks-zone.html', 'goldilocks-cruise.html']) {
    const html = read(page);
    assert.match(html, /<link rel="stylesheet" href="goldilocks-trajectory\.css">/);
    assert.match(html, /<script src="goldilocks-trajectory\.js"><\/script>/);
    assert.match(html, /<summary>Projected BAC trajectory<\/summary>/);
    assert.match(html, /id="reviewTrajectory"/);
    assert.match(html, /GoldilocksTrajectory\.render\(document\.getElementById\('reviewTrajectory'\)/);
    assert.match(html, /absorption (?:is|are) not modeled/i);
  }
});

test('all pages use the exact original logo artwork in a theme-independent brand stage', () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /class="brand-lockup(?:\s+brand-lockup--mission)?"/);
    assert.match(html, /<h1 class="logo logo--original" aria-label="Goldilocks">/);
    assert.match(html, /class="brand-art-crop" aria-hidden="true"/);
    assert.match(html, /class="brand-original-art" src="goldilocks-original-lockup\.jpg\?v=20260722-og" alt=""/);
  }

  const artwork = fs.readFileSync(path.join(root, 'goldilocks-original-lockup.jpg'));
  assert.equal(artwork.subarray(0, 3).toString('hex'), 'ffd8ff', 'original artwork must remain a JPEG');
  assert.equal(
    crypto.createHash('sha256').update(artwork).digest('hex'),
    'b0bff74d4003f83c62535a037d923c2e5cddda2b241b0b64365050dd23182c15',
    'original artwork pixels must remain unchanged'
  );
});

test('Pace branding is consistent while legacy compatibility remains', () => {
  const html = read('goldilocks-cruise.html');
  assert.match(html, /<title>Goldilocks — Pace<\/title>/);
  assert.match(html, /<div class="logo-sub">Pace<\/div>/);
  assert.match(html, />Start Pace Session<\/button>/);
  assert.match(html, />Pace Plan<\/h2>/);
  assert.doesNotMatch(html, />Cruise(?: Mode| Settings)?</);
  assert.doesNotMatch(html, /Launch Cruise/);
  assert.match(html, /goldilocks_cruise_session/);

  const landing = read('index.html');
  assert.match(landing, /<h3 class="mode-name">Pace<\/h3>/);
  assert.match(landing, /href="goldilocks-cruise\.html"/);
  assert.doesNotMatch(landing, /Cruise Mode|coast smoothly/);
});

test('Calibration branding is consistent while legacy compatibility remains', () => {
  const html = read('goldilocks-training.html');
  assert.match(html, /<title>Goldilocks Calibration<\/title>/);
  assert.match(html, /<p class="logo-sub">Calibration<\/p>/);
  assert.match(html, />⊹ Start Calibration — Start Timer<\/button>/);
  assert.match(html, />Calibration Steps<\/div>/);
  assert.doesNotMatch(html, />Training(?: Mode| Protocol)?</);
  assert.match(html, /goldilocks_training_session/);

  const landing = read('index.html');
  assert.match(landing, /<h3 class="mode-name">Calibration<\/h3>/);
  assert.match(landing, /Personalize your BAC model/);
  assert.match(landing, /href="goldilocks-training\.html"/);
  assert.doesNotMatch(landing, /<h3 class="mode-name">Training<\/h3>/);

  const state = read('goldilocks-session-state.js');
  assert.match(state, /label: 'Calibration'/);
});

test('Mission Control inspects resumable sessions without mutating them', () => {
  const html = read('index.html');
  const coreIndex = html.search(/<script src="goldilocks-core\.js(?:\?[^\"]+)?"><\/script>/);
  const stateIndex = html.search(/<script src="goldilocks-session-state\.js(?:\?[^\"]+)?"><\/script>/);
  assert.ok(coreIndex >= 0 && stateIndex > coreIndex, 'calculation core must load before session inspection');
  assert.match(html, /id="resumeSection"/);
  assert.match(html, /GoldilocksSessionState\.inspectStorage\s*\(/);
  assert.match(html, /entry\.state\s*===\s*['"]scheduled['"]/);
  assert.match(html, /Session scheduled/);
  assert.match(html, /addEventListener\('pageshow'/);
  assert.doesNotMatch(html, /localStorage\.(?:removeItem|clear)\s*\(/);
});

test('Calibration saves profiles for and hands off to both planners', () => {
  const html = read('goldilocks-training.html');
  assert.doesNotMatch(html, /Save Profile to Goldilocks Zone|Goldilocks Zone dropdown|open Goldilocks Zone/);
  assert.match(html, /Save Profile to Goldilocks/);
  assert.match(html, /available in both Zone and Pace/i);
  assert.match(html, /Plan in Zone/);
  assert.match(html, /Plan in Pace/);
  assert.match(html, /id="profileHandoff"/);
});

test('Calibration explains fasted behavior without implying a safer metabolism', () => {
  const html = read('goldilocks-training.html');
  const fastedInput = openingTagWithId(html, 'fastedInput');
  assert.match(fastedInput, /\baria-describedby="fastedTrainingHelp"/i);

  const helpStart = html.indexOf('id="fastedTrainingHelp"');
  assert.ok(helpStart >= 0, 'Calibration must expose #fastedTrainingHelp');
  const help = html.slice(helpStart, helpStart + 650);
  assert.match(help, /elimination rate is kept/i);
  assert.match(help, /rise rate is excluded from the profile average/i);
  assert.match(help, /protocol timing is unchanged/i);

  const metabolismResult = openingTagWithId(html, 'resMetab');
  assert.doesNotMatch(metabolismResult, /\bgreen\b/i, 'metabolism must not have a success color');
  assert.doesNotMatch(html, /\bmetabColor\b/, 'metabolism color must not classify a rate as good or safe');
});

test('Calibration confirms destructive session resets', () => {
  const html = read('goldilocks-training.html');
  const cancel = functionSource(html, 'cancelProtocol');
  const reset = functionSource(html, 'resetToSetup');
  assert.ok(cancel, 'Calibration must define cancelProtocol()');
  assert.match(cancel, /\bprotocolActive\b/);
  assert.match(cancel, /\bconfirm\s*\(/, 'canceling an active protocol must require confirmation');
  assert.ok(reset, 'Calibration must define resetToSetup()');
  assert.match(reset, /completedProtocolId/);
  assert.match(reset, /savedProtocolId/);
  assert.match(reset, /\bconfirm\s*\(/, 'discarding unsaved completed results must require confirmation');
});

test('pages expose a semantic top-level structure and reduced-motion fallback', () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /<h1\b/i, `${page} must have an h1`);
    assert.match(html, /<main\b/i, `${page} must have a main landmark`);
    assert.match(
      html,
      /prefers-reduced-motion\s*:\s*reduce/i,
      `${page} must respect reduced-motion preferences`
    );
  }
});

test('static form fields have accessible names', () => {
  for (const page of modePages) {
    const html = read(page);
    const ids = new Set(
      [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
    );
    const labels = new Set(
      [...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/gi)].map((match) => match[1])
    );
    for (const match of html.matchAll(/<(?:input|select|textarea)\b([^>]*)>/gi)) {
      const attributes = match[1];
      const id = attributes.match(/\bid="([^"]+)"/i)?.[1];
      const ariaLabel = attributes.match(/\baria-label="([^"]+)"/i)?.[1];
      const labelledBy = attributes.match(/\baria-labelledby="([^"]+)"/i)?.[1];
      if (labelledBy) {
        for (const labelId of labelledBy.trim().split(/\s+/)) {
          assert.ok(ids.has(labelId), `${page}#${id} references missing label ID ${labelId}`);
        }
      }
      const namedInline = Boolean(ariaLabel?.trim() || labelledBy?.trim());
      assert.ok(id, `${page} contains a form field without an id`);
      assert.ok(
        namedInline || labels.has(id),
        `${page}#${id} must have a label or ARIA name`
      );
    }
  }
});

test('manifest targets and declared PNG dimensions are valid', () => {
  for (const manifestName of ['manifest.json', 'manifest-training.json']) {
    const manifest = JSON.parse(read(manifestName));
    const startTarget = manifest.start_url.replace(/^\.\//, '');
    assert.ok(fs.existsSync(path.join(root, startTarget)), `${manifestName} start_url must exist`);
    const declaredSizes = new Set();
    for (const icon of manifest.icons) {
      const iconPath = icon.src.replace(/^\.\//, '').split(/[?#]/, 1)[0];
      const dimensions = pngDimensions(iconPath);
      const declared = icon.sizes.split(/\s+/);
      declared.forEach((size) => declaredSizes.add(size));
      assert.ok(
        declared.includes(`${dimensions.width}x${dimensions.height}`),
        `${manifestName} must declare the actual dimensions of ${iconPath}`
      );
    }
    assert.ok(declaredSizes.has('192x192'), `${manifestName} must provide a 192x192 icon`);
    assert.ok(declaredSizes.has('512x512'), `${manifestName} must provide a 512x512 icon`);
  }
});
