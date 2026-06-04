#!/usr/bin/env node
/**
 * Build gate: runs `tsc --noEmit` and FAILS the build only on the fatal
 * error classes that crash the app at runtime (undefined names, use-before-
 * declaration, etc.) — the exact class that white-screened the site on
 * 2026-06-03 (`nifcPerimeters is not defined`, TS2304).
 *
 * It deliberately does NOT fail on the ~100 pre-existing non-fatal errors
 * (versioned-import module resolution, minor type mismatches) so the gate is
 * adoptable today without a giant cleanup. Tighten the allowed set over time.
 */
const { execSync } = require('child_process');

// Codes that mean "this will throw at runtime if reached":
//  2304 Cannot find name 'X'            2552 Cannot find name 'X'. Did you mean...
//  2448 Block-scoped var used before declaration   2454 Variable used before assigned
//  18004 No value for shorthand property  17004 Cannot use JSX without --jsx
const FATAL = /error TS(2304|2552|2448|2454|18004|17004):/;

let out = '';
try {
  out = execSync('node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json',
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '');
}

const fatal = out.split('\n').filter((l) => FATAL.test(l));
if (fatal.length) {
  console.error('\n❌ TYPECHECK GATE FAILED — fatal reference errors that WILL crash at runtime:\n');
  fatal.forEach((l) => console.error('  ' + l.trim()));
  console.error('\nFix these before the build can proceed (they are the white-screen class).\n');
  process.exit(1);
}
console.log('✓ typecheck gate passed (no fatal undefined-name / use-before-decl errors)');
