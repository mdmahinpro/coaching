/* Shared disposable-target guard for E2E harnesses.
 *
 * Every selected harness MUST call these before any login, seed, mutation, or
 * cleanup. The guard refuses:
 *   - missing configuration;
 *   - the original/customer project (flbvusudwszxdylxevfe);
 *   - any project other than the approved disposable project
 *     (hjzwbicauyxffrmdhvgy);
 *   - a running app/server whose configured project does not match.
 *
 * It never prints keys.
 */
const fs = require('fs');
const path = require('path');
const runtimeConfig = require('./isolated-config.cjs');

const ORIGINAL_PROJECT_REF = 'flbvusudwszxdylxevfe';
const DISPOSABLE_PROJECT_REF = 'hjzwbicauyxffrmdhvgy';

function projectRefFromUrl(url) {
  try {
    return new URL(String(url)).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

function blocked(message) {
  console.error('BLOCKED: ' + message);
  process.exit(2);
}

/**
 * Pure decision for a candidate target. Returns:
 *   { ok: true, ref } | { ok: false, reason }
 * Never exits, so it can be unit-tested.
 */
function evaluateDisposableTarget(url, key) {
  if (!url || !key) {
    return {
      ok: false,
      reason:
        'missing E2E_DISPOSABLE_SUPABASE_URL / E2E_DISPOSABLE_SUPABASE_ANON_KEY ' +
        `for the approved disposable project ${DISPOSABLE_PROJECT_REF}.`,
    };
  }
  const ref = projectRefFromUrl(url);
  if (ref === ORIGINAL_PROJECT_REF) {
    return { ok: false, reason: `refusing original/customer project ${ORIGINAL_PROJECT_REF}.` };
  }
  if (ref !== DISPOSABLE_PROJECT_REF || !runtimeConfig.exactTarget(url)) {
    return {
      ok: false,
      reason: `refusing project ${ref ?? '<unparseable>'}: only ${DISPOSABLE_PROJECT_REF} is approved.`,
    };
  }
  try {
    runtimeConfig.validateKey(key, 'anon', 'Public key');
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  return { ok: true, ref };
}

/**
 * Validate the process configuration and return the disposable target.
 * Exits 2 (fail closed) on any missing/refused configuration.
 */
function requireDisposableTarget() {
  let config;
  try {
    config = runtimeConfig.loadIsolatedConfig({ root: path.resolve(__dirname, '..') });
  } catch (error) {
    blocked(error.message);
  }
  const mapped = runtimeConfig.childEnvironment(config);
  for (const name of [
    'E2E_DISPOSABLE_SUPABASE_URL',
    'E2E_DISPOSABLE_SUPABASE_ANON_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]) {
    process.env[name] = mapped[name];
  }
  const url = config.url;
  const key = config.anonKey;
  const decision = evaluateDisposableTarget(url, key);
  if (!decision.ok) {
    blocked(decision.reason);
  }
  return { url, key, projectRef: decision.ref };
}

/** Assert an arbitrary URL/ref string points at the approved disposable project. */
function assertDisposableRef(value, label) {
  const ref =
    value === DISPOSABLE_PROJECT_REF
      ? value
      : runtimeConfig.exactTarget(value)
        ? DISPOSABLE_PROJECT_REF
        : null;
  if (ref === ORIGINAL_PROJECT_REF) {
    blocked(`${label} targets the original project ${ORIGINAL_PROJECT_REF}.`);
  }
  if (ref !== DISPOSABLE_PROJECT_REF) {
    blocked(`${label} targets ${ref ?? '<unknown>'}, not ${DISPOSABLE_PROJECT_REF}.`);
  }
  return ref;
}

/**
 * Browser-side assertion: the running frontend (Vite) resolves its Supabase
 * client to the disposable target. Call with a puppeteer page.
 */
async function assertAppTargetsDisposable(page, expectedUrl) {
  const actual = await page.evaluate(async () => {
    const mod = await import('/src/lib/supabase.ts');
    return mod.supabase && mod.supabase.supabaseUrl;
  });
  if (actual === ORIGINAL_PROJECT_REF || projectRefFromUrl(actual) === ORIGINAL_PROJECT_REF) {
    throw new Error(`BLOCKED: running app frontend targets the original project (${actual}).`);
  }
  if (actual !== expectedUrl) {
    throw new Error(
      `BLOCKED: running app frontend targets ${actual}, not the disposable URL. ` +
        'Start it with the isolated test launch config (node e2e/run-isolated.cjs).'
    );
  }
  return actual;
}

/**
 * Server-side assertion: the local API runtime reports the disposable project.
 * Checks the running isolated configuration. Health does not prove upstream
 * credentials, database permissions, or workflow behavior.
 */
async function assertServerEndpointsDisposable(baseUrl, expectedUrl) {
  const endpoint = String(baseUrl).replace(/\/+$/, '') + '/api/__e2e/health';
  let res;
  try {
    res = await fetch(endpoint, { method: 'GET' });
  } catch (e) {
    throw new Error(
      `BLOCKED: local server runtime health endpoint unreachable at ${endpoint}. ` +
        'Start the app with the isolated test launch config (node e2e/run-isolated.cjs).'
    );
  }
  if (!res.ok) {
    throw new Error(
      `BLOCKED: local server runtime health returned ${res.status}. ` +
        'It is not configured for the disposable project (SUPABASE_URL missing?).'
    );
  }
  const body = await res.json().catch(() => ({}));
  if (body.projectRef === ORIGINAL_PROJECT_REF) {
    throw new Error('BLOCKED: local server endpoints target the original project.');
  }
  if (
    !runtimeConfig.exactTarget(expectedUrl) ||
    body.runtime !== 'techely-isolated-v2' ||
    body.serverConfigured !== true ||
    body.projectRef !== projectRefFromUrl(expectedUrl)
  ) {
    throw new Error(
      `BLOCKED: local server endpoints target ${body.projectRef ?? '<unknown>'}, not the disposable project.`
    );
  }
  return body.projectRef;
}

/**
 * Read the isolated credential file for the disposable project only. Deliberately
 * separate from `.env.local` so original-project values cannot leak in.
 */
function readIsolatedCreds() {
  const file = path.join(__dirname, 'isolated-creds.json');
  if (!fs.existsSync(file)) {
    blocked(
      `missing ${path.relative(process.cwd(), file)}. Create it locally (git-ignored) with ` +
        '{"email":"<disposable admin email>","password":"<disposable admin password>"}.'
    );
  }
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    blocked(`${file} is not valid JSON.`);
  }
  if (!creds || !creds.email || !creds.password) {
    blocked(`${file} must contain non-empty "email" and "password".`);
  }
  return creds;
}

function isolatedBaseUrl() {
  const config = runtimeConfig.loadIsolatedConfig({ root: path.resolve(__dirname, '..') });
  return `http://127.0.0.1:${config.port}`;
}

module.exports = {
  isolatedBaseUrl,
  ORIGINAL_PROJECT_REF,
  DISPOSABLE_PROJECT_REF,
  projectRefFromUrl,
  evaluateDisposableTarget,
  requireDisposableTarget,
  assertDisposableRef,
  assertAppTargetsDisposable,
  assertServerEndpointsDisposable,
  readIsolatedCreds,
};
