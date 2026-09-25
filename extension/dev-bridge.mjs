#!/usr/bin/env node
/**
 * dev-bridge.mjs — standalone local WebSocket server for the apply-bridge POC.
 *
 * Proves the end-to-end mechanism in isolation, without the full dashboard
 * running: asks the extension (in the user's own, already-open Chrome) to
 * open a job URL in a new tab, detect its fields, then fill the simple
 * identity ones (first/last/full name, email, phone) from
 * config/profile.yml — no separate automated browser process, no CDP
 * debug-port flag on the user's real Chrome.
 *
 * The actual request/response logic lives in apply-bridge-lib.mjs, shared
 * with ui/server.mjs's real integration — this file is just the standalone
 * transport + CLI wrapper around it.
 *
 * Usage:
 *   node extension/dev-bridge.mjs                                     # start the bridge, wait for the extension
 *   node extension/dev-bridge.mjs <job-application-url> [asia|europe] # detect + fill identity fields once connected
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import { buildIdentity } from '../lib/apply-spec.mjs';
import { ApplyBridge, createStandaloneApplyBridge, classifySimpleField } from './apply-bridge-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8934;
const targetUrl = process.argv[2] || null;
const region = process.argv[3] === 'asia' ? 'asia' : 'europe';

async function loadIdentity() {
  const profile = yaml.load(await readFile(join(ROOT, 'config', 'profile.yml'), 'utf-8'));
  return buildIdentity(profile, region);
}

const bridge = new ApplyBridge();
createStandaloneApplyBridge(bridge, { port: PORT, log: (m) => console.log(`[dev-bridge] ${m}`) });
console.log(`[dev-bridge] listening on ws://127.0.0.1:${PORT} (region: ${region})`);
console.log('[dev-bridge] waiting for the extension to connect (load it unpacked, see extension/README.md)...');

const originalAttach = bridge.attach.bind(bridge);
bridge.attach = (socket) => {
  originalAttach(socket);
  if (targetUrl) runOnce();
};

async function runOnce() {
  console.log(`[dev-bridge] requesting field detection for ${targetUrl}`);
  let detected;
  try {
    detected = await bridge.detectFields(targetUrl);
  } catch (err) {
    console.error(`[dev-bridge] detection failed: ${err.message}`);
    return;
  }
  console.log(`\n[dev-bridge] ${detected.fields.length} field(s) detected on ${targetUrl}\n`);
  for (const f of detected.fields) {
    const req = f.required ? '✱' : ' ';
    console.log(`  ${req} [${f.type}] ${f.label || '(no label)'}${f.value ? ` = "${String(f.value).slice(0, 40)}"` : ''}`);
  }

  const identity = await loadIdentity();
  const updates = detected.fields
    .filter((f) => !f.value)
    .map((f) => ({ i: f.i, value: classifySimpleField(f, identity), label: f.label }))
    .filter((u) => u.value);

  if (!updates.length) {
    console.log('[dev-bridge] no simple identity fields to fill on this form.\n');
    return;
  }
  console.log(`\n[dev-bridge] filling ${updates.length} identity field(s):`);
  for (const u of updates) console.log(`  → "${u.label}" = "${u.value}"`);

  try {
    const result = await bridge.fillFields(detected.tabId, updates);
    console.log('\n[dev-bridge] fill outcomes:');
    for (const o of result.outcomes) {
      console.log(o.ok ? `  ✅ field #${o.i} → "${o.actualValue}"` : `  ❌ field #${o.i}: ${o.reason}`);
    }
    console.log('\n[dev-bridge] done — check the tab in your Chrome window.\n');
  } catch (err) {
    console.error(`[dev-bridge] fill failed: ${err.message}`);
  }
}
