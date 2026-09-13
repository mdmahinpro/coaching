/* One-command local runtime. No database setup, migrations, or original .env.local. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadIsolatedConfig, childEnvironment } = require('./isolated-config.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const checkOnly = process.argv.includes('--check');
  let config;
  try {
    config = loadIsolatedConfig({ root });
  } catch (error) {
    if (
      !checkOnly &&
      error.code === 'ISOLATED_CONFIG_MISSING' &&
      process.stdin.isTTY &&
      process.stdout.isTTY
    ) {
      config = await require('./isolated-setup.cjs').promptConfig(process.env, root);
    } else {
      throw error;
    }
  }
  console.log(
    JSON.stringify(
      {
        status: 'isolated-config-ok',
        runtime: 'techely-isolated-v2',
        projectRef: config.projectRef,
        serverConfigured: true,
        configSource: config.source,
        port: config.port,
        isolatedCredsFile: fs.existsSync(path.join(__dirname, 'isolated-creds.json')),
        credentialValidation: 'format-and-declared-project-only; no upstream connection yet',
      },
      null,
      2
    )
  );
  if (checkOnly) {
    return;
  }
  let viteCli;
  try {
    viteCli = path.join(
      path.dirname(require.resolve('vite/package.json', { paths: [root] })),
      'bin',
      'vite.js'
    );
  } catch {
    throw new Error(
      'Local Vite is unavailable. Install the existing package dependencies; no automatic download was attempted.'
    );
  }
  console.log(
    `Starting http://127.0.0.1:${config.port}/ against the temporary project only. Keep this terminal open.`
  );
  const child = spawn(
    process.execPath,
    [
      viteCli,
      '--config',
      'vite.isolated.config.ts',
      '--host',
      '127.0.0.1',
      '--port',
      String(config.port),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      env: childEnvironment(config),
    }
  );
  child.on('error', (error) => {
    console.error(`BLOCKED: runtime could not start (${error.code || 'SPAWN_FAILED'}).`);
    process.exitCode = 2;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : (code ?? 1);
  });
}
main().catch((error) => {
  console.error(`BLOCKED: ${error.message}`);
  process.exitCode = 2;
});
