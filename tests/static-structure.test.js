'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pages = [
  'index.html',
  'goldilocks-zone.html',
  'goldilocks-cruise.html',
  'goldilocks-training.html',
];
const modePages = pages.filter((page) => page !== 'index.html');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
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
      'bacPerDrink', 'simulate', 'estimateLiveBac', 'buildZoneSchedule', 'widmarkRisePerStd',
    ],
    'goldilocks-cruise.html': [
      'bacPerDrink', 'simulateDuration', 'estimateLiveBac',
      'buildCruiseCapacityPlan', 'buildCruiseReplan',
    ],
    'goldilocks-training.html': [
      'calculateCalibration', 'fitLine', 'widmarkRisePerStd',
    ],
  };
  for (const page of modePages) {
    const html = read(page);
    assert.match(
      html,
      /<script\s+src="goldilocks-core\.js"\s*><\/script>/i,
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

test('Zone and Cruise use the shared custom-drink store', () => {
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

test('Cruise exposes 15-minute mission-duration planning', () => {
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
      const iconPath = icon.src.replace(/^\.\//, '');
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
