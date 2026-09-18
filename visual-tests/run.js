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
const { connect, openPage } = require('./driver');
const { wrap } = require('./probe');
const { FORMATS, SCENARIOS } = require('./scenarios');

const APP_URL = process.env.PPVIEW_URL || 'http://localhost:3111/ppview';
const APP_ORIGIN = new URL(APP_URL).origin;
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
// Scenarios are independent, so they run in parallel tabs. The suite is
// dominated by waiting for the app, not by CPU, so concurrency helps a lot —
// though every worker shares one software-rasterised GPU, so more is not
// linearly better.
const WORKERS = Number(
  (process.argv.find(a => a.startsWith('--workers=')) || '').split('=')[1] || process.env.PPVIEW_WORKERS || 4,
);

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const formats = ONLY ? FORMATS.filter(f => f.name === ONLY) : FORMATS;

  // Flatten to a work queue so every worker stays busy regardless of how much
  // each individual scenario costs.
  const jobs = [];
  for (const format of formats) {
    for (const [scenario, body] of Object.entries(SCENARIOS)) {
      jobs.push({ format, scenario, body });
    }
  }

  const results = {};
  const errors = [];
  const timings = [];
  let next = 0;

  const worker = async (id) => {
    const cdp = await connect(9222, await openPage(9222));
    try {
      for (;;) {
        const index = next++;
        if (index >= jobs.length) return;
        const { format, scenario, body } = jobs[index];
        const key = `${format.name}/${scenario}`;
        const started = Date.now();
        try {
          // Fresh state per scenario: localStorage carries colour scheme,
          // lighting and panel positions, so scenarios would otherwise
          // contaminate each other.
          await cdp.clearStorage(APP_ORIGIN);
          await cdp.goto(APP_URL);
          await cdp.dropFiles(format.files);

          results[key] = await cdp.evaluate(wrap(body));
          await cdp.screenshot(path.join(SHOTS, `${format.name}-${scenario}.png`));

          const bad = cdp.logs.filter(l =>
            l.level === 'exception' || l.level === 'error' || /mismatch|failed/i.test(l.text));
          if (bad.length) errors.push(`${key}: ${bad.map(b => b.text).join(' | ').slice(0, 200)}`);
        } catch (e) {
          errors.push(`${key}: ${e.message}`);
          results[key] = { error: e.message };
        }
        const ms = Date.now() - started;
        timings.push({ key, ms });
        console.log(`  [w${id}] ${key} ${ms}ms`);
      }
    } finally {
      cdp.close();
    }
  };

  await Promise.all(Array.from({ length: Math.min(WORKERS, jobs.length) }, (_, i) => worker(i + 1)));
  return { results, errors, timings };
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
  console.log(`visual regression against ${APP_URL}`);
  const startedAll = Date.now();
  const { results, errors, timings } = await run();
  fs.writeFileSync(path.join(__dirname, 'last-run.json'), JSON.stringify(results, null, 2) + '\n');

  const total = ((Date.now() - startedAll) / 1000).toFixed(1);
  const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 3)
    .map(t => `${t.key} ${t.ms}ms`).join(', ');
  console.log(`\n${timings.length} scenarios in ${total}s across ${WORKERS} workers` +
    (slowest ? ` — slowest: ${slowest}` : ''));

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
