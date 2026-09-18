#!/usr/bin/env node
/**
 * Visual regression runner.
 *
 *   node visual-tests/run.js --update    record a new baseline
 *   node visual-tests/run.js             compare against the committed baseline
 *
 * Expects the dev server on $PPVIEW_URL (default http://localhost:3111/ppview)
 * and headless Chrome listening on port 9222. `npm run test:visual` starts both.
 */
const fs = require('fs');
const path = require('path');
const { connect } = require('./driver');
const { wrap } = require('./probe');
const { FORMATS, SCENARIOS } = require('./scenarios');

const URL = process.env.PPVIEW_URL || 'http://localhost:3111/ppview';
const BASELINE = path.join(__dirname, 'baseline.json');
const SHOTS = path.join(__dirname, 'shots');
const UPDATE = process.argv.includes('--update');
// Antialiasing shifts counts by a pixel or two between runs, and a purely
// relative tolerance is far too tight on the small buckets. A real change —
// geometry appearing, vanishing, resizing or losing its colour — moves counts by
// hundreds, so requiring both an absolute and a relative margin costs nothing.
const TOLERANCE = 0.02;
const ABSOLUTE_SLACK = 6;
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const cdp = await connect();
  const results = {};
  const errors = [];

  const formats = ONLY ? FORMATS.filter(f => f.name === ONLY) : FORMATS;

  for (const format of formats) {
    for (const [scenario, body] of Object.entries(SCENARIOS)) {
      const key = `${format.name}/${scenario}`;
      process.stdout.write(`  ${key} … `);
      try {
        // Fresh page per scenario: localStorage carries colour scheme, lighting
        // and panel positions, so scenarios would otherwise contaminate each other.
        await cdp.goto('about:blank', 300);
        await cdp.goto(URL, 2500);
        await cdp.evaluate('localStorage.clear()');
        await cdp.goto(URL, 2500);
        await cdp.dropFiles(format.files);

        const value = await cdp.evaluate(wrap(body));
        results[key] = value;
        await cdp.screenshot(path.join(SHOTS, `${format.name}-${scenario}.png`));

        const bad = cdp.logs.filter(l =>
          l.level === 'exception' || l.level === 'error' ||
          /mismatch|failed/i.test(l.text));
        if (bad.length) {
          errors.push(`${key}: ${bad.map(b => b.text).join(' | ').slice(0, 200)}`);
        }
        console.log('ok');
      } catch (e) {
        console.log('FAILED');
        errors.push(`${key}: ${e.message}`);
        results[key] = { error: e.message };
      }
    }
  }
  cdp.close();
  return { results, errors };
}

function compare(current, baseline) {
  const diffs = [];
  const walk = (a, b, trail) => {
    if (typeof a === 'number' && typeof b === 'number') {
      const delta = Math.abs(a - b);
      if (delta > ABSOLUTE_SLACK && delta / Math.max(Math.abs(b), 1) > TOLERANCE) {
        diffs.push(`${trail}: ${b} → ${a}`);
      }
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        walk(a[k], b[k], `${trail}.${k}`);
      }
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${trail}: ${JSON.stringify(b)} → ${JSON.stringify(a)}`);
  };
  for (const key of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    walk(current[key], baseline[key], key);
  }
  return diffs;
}

(async () => {
  console.log(`visual regression against ${URL}`);
  const { results, errors } = await run();

  if (UPDATE) {
    // Merge, so --only --update refreshes one format without dropping the rest.
    const previous = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
    fs.writeFileSync(BASELINE, JSON.stringify({ ...previous, ...results }, null, 2) + '\n');
    console.log(`\nbaseline written: ${Object.keys(results).length} scenarios`);
    if (errors.length) {
      console.log('\nconsole problems recorded while capturing:');
      errors.forEach(e => console.log('  ! ' + e));
    }
    process.exit(0);
  }

  if (!fs.existsSync(BASELINE)) {
    console.error('no baseline; run with --update first');
    process.exit(2);
  }
  const full = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  // With --only, compare against just the slice that was actually run;
  // everything else would otherwise read as "disappeared".
  const baseline = ONLY
    ? Object.fromEntries(Object.entries(full).filter(([k]) => k.startsWith(ONLY + '/')))
    : full;
  const diffs = compare(results, baseline);

  if (errors.length) {
    console.log('\nerrors:');
    errors.forEach(e => console.log('  ! ' + e));
  }
  if (diffs.length) {
    console.log(`\n${diffs.length} measurement(s) moved:`);
    diffs.forEach(d => console.log('  ~ ' + d));
  } else {
    console.log('\nno visual change');
  }
  process.exit(diffs.length || errors.length ? 1 : 0);
})();
