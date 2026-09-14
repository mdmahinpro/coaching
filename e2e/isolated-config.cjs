'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_REF = 'hjzwbicauyxffrmdhvgy';
const ORIGINAL_REF = 'flbvusudwszxdylxevfe';
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`;
const DEFAULT_PORT = 5199;

function configPath(env = process.env) {
  return path.resolve(
    env.E2E_ISOLATED_CONFIG_FILE ||
      path.join(os.homedir(), '.techely', PROJECT_REF, 'isolated-runtime.json')
  );
}
function assertExternalConfigPath(file, root) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
    throw new Error('The isolated key file must be outside the application repository.');
  }
}
function exactTarget(value) {
  try {
    const u = new URL(value);
    return (
      u.origin === PROJECT_URL &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.pathname === '/' || u.pathname === '')
    );
  } catch {
    return false;
  }
}
function keyKind(key) {
  if (typeof key !== 'string' || !key.trim()) {
    return null;
  }
  const value = key.trim();
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(value)) {
    return { role: 'anon', ref: null };
  }
  if (/^sb_secret_[A-Za-z0-9_-]{8,}$/.test(value)) {
    return { role: 'service_role', ref: null };
  }
  try {
    const parts = value.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!['anon', 'service_role'].includes(p.role)) {
      return null;
    }
    return { role: p.role, ref: typeof p.ref === 'string' ? p.ref : null };
  } catch {
    return null;
  }
}
function validateKey(value, wantedRole, label) {
  const kind = keyKind(value);
  if (!kind || kind.role !== wantedRole) {
    throw new Error(
      `${label} has the wrong key type. Use the approved temporary project's ${wantedRole === 'anon' ? 'public' : 'server-only'} key.`
    );
  }
  if (kind.ref && kind.ref !== PROJECT_REF) {
    throw new Error(
      `${label} belongs to a different project. Original-project keys are not allowed.`
    );
  }
  return value.trim();
}
function normalize(values, source = 'process-env') {
  if (!exactTarget(values.url)) {
    throw new Error(`Only the exact HTTPS temporary project ${PROJECT_REF} is allowed.`);
  }
  if (values.serverUrl && !exactTarget(values.serverUrl)) {
    throw new Error('SUPABASE_URL conflicts with the isolated project. No server will start.');
  }
  if (!values.anonKey || !values.serviceKey) {
    const missing = [];
    if (!values.anonKey) {
      missing.push('E2E_DISPOSABLE_SUPABASE_ANON_KEY');
    }
    if (!values.serviceKey) {
      missing.push('SUPABASE_SERVICE_ROLE_KEY');
    }
    const error = new Error(
      `Missing isolated configuration: ${missing.join(', ')}. Run pnpm e2e:isolated in an interactive terminal for hidden key entry.`
    );
    error.code = 'ISOLATED_CONFIG_MISSING';
    throw error;
  }
  const anonKey = validateKey(values.anonKey, 'anon', 'Public key');
  const serviceKey = validateKey(values.serviceKey, 'service_role', 'Server key');
  const port = Number(values.port || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('ISOLATED_PORT must be an integer from 1024 to 65535.');
  }
  return { url: PROJECT_URL, anonKey, serviceKey, port, projectRef: PROJECT_REF, source };
}
function loadIsolatedConfig({ env = process.env, root = process.cwd() } = {}) {
  const file = configPath(env);
  assertExternalConfigPath(file, root);
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('The isolated key file must be a regular file, not a symbolic link.');
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new Error('The isolated key file must have owner-only permissions (0600).');
    }
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error(
        'The local isolated key file is not valid JSON. Do not paste its contents into chat.'
      );
    }
    if (stored.version !== 1 || stored.projectRef !== PROJECT_REF) {
      throw new Error('Local key file project/version mismatch.');
    }
    const config = normalize(
      {
        url: PROJECT_URL,
        anonKey: stored.anonKey,
        serviceKey: stored.serviceKey,
        port: env.ISOLATED_PORT,
      },
      'local-file'
    );
    // Saved configuration is a complete source, not a key-by-key fallback.
    // Matching partial variables from an earlier terminal session are harmless;
    // conflicting keys/targets require the operator to choose deliberately.
    if (env.E2E_DISPOSABLE_SUPABASE_URL && !exactTarget(env.E2E_DISPOSABLE_SUPABASE_URL)) {
      throw new Error('Process disposable URL conflicts with the saved temporary configuration.');
    }
    if (env.SUPABASE_URL && !exactTarget(env.SUPABASE_URL)) {
      throw new Error('SUPABASE_URL conflicts with the saved temporary configuration.');
    }
    if (
      env.E2E_DISPOSABLE_SUPABASE_ANON_KEY &&
      env.E2E_DISPOSABLE_SUPABASE_ANON_KEY.trim() !== config.anonKey
    ) {
      throw new Error('Process public key conflicts with the saved temporary configuration.');
    }
    if (
      env.SUPABASE_SERVICE_ROLE_KEY &&
      env.SUPABASE_SERVICE_ROLE_KEY.trim() !== config.serviceKey
    ) {
      throw new Error('Process server key conflicts with the saved temporary configuration.');
    }
    return config;
  }
  if (env.E2E_DISPOSABLE_SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY) {
    return normalize(
      {
        url: env.E2E_DISPOSABLE_SUPABASE_URL || PROJECT_URL,
        serverUrl: env.SUPABASE_URL,
        anonKey: env.E2E_DISPOSABLE_SUPABASE_ANON_KEY,
        serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
        port: env.ISOLATED_PORT,
      },
      'process-env'
    );
  }
  const error = new Error(
    'No isolated key configuration found. Run pnpm e2e:isolated in an interactive terminal for hidden key entry.'
  );
  error.code = 'ISOLATED_CONFIG_MISSING';
  throw error;
}

function childEnvironment(config, parent = process.env) {
  const env = { ...parent };
  // Only explicitly approved public configuration may reach Vite's browser env.
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_')) {
      delete env[key];
    }
  }
  const projectRef = new URL(config.url).hostname.split('.')[0];
  Object.assign(env, {
    E2E_DISPOSABLE_SUPABASE_URL: config.url,
    E2E_DISPOSABLE_SUPABASE_ANON_KEY: config.anonKey,
    SUPABASE_URL: config.url,
    SUPABASE_ANON_KEY: config.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceKey,
    EXPECTED_SUPABASE_PROJECT_REF: projectRef,
    ENVIRONMENT_KIND: 'test',
    VITE_SUPABASE_URL: config.url,
    VITE_SUPABASE_ANON_KEY: config.anonKey,
    VITE_EXPECTED_SUPABASE_PROJECT_REF: projectRef,
    VITE_ENVIRONMENT_KIND: 'test',
    VITE_SITE_URL: `http://127.0.0.1:${config.port}`,
    ISOLATED_PORT: String(config.port),
    TECHELY_ISOLATED_RUNTIME: '1',
    TECHELY_ISOLATED_CONFIG_SOURCE: config.source,
  });
  return env;
}
module.exports = {
  PROJECT_REF,
  ORIGINAL_REF,
  PROJECT_URL,
  DEFAULT_PORT,
  configPath,
  assertExternalConfigPath,
  exactTarget,
  keyKind,
  validateKey,
  normalize,
  loadIsolatedConfig,
  childEnvironment,
};
