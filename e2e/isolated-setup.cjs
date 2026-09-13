'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const {
  PROJECT_REF,
  PROJECT_URL,
  configPath,
  assertExternalConfigPath,
  normalize,
} = require('./isolated-config.cjs');

function hiddenInput(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || !process.stdout.isTTY || typeof input.setRawMode !== 'function') {
      reject(
        new Error(
          'Hidden key input requires an interactive terminal. Use secure process environment variables instead.'
        )
      );
      return;
    }
    let value = '';
    const wasRaw = Boolean(input.isRaw);
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    process.stdout.write(`${label} (hidden): `);
    function finish(error) {
      input.removeListener('keypress', onKey);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write('\n');
      if (error) {
        reject(error);
      } else {
        resolve(value.trim());
      }
      value = '';
    }
    function onKey(text, key = {}) {
      if (key.ctrl && key.name === 'c') {
        finish(new Error('Setup cancelled.'));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish();
        return;
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1);
        return;
      }
      if (key.ctrl && key.name === 'u') {
        value = '';
        return;
      }
      if (!key.ctrl && !key.meta && text && /^[\x20-\x7e]+$/.test(text)) {
        value += text;
      }
    }
    input.on('keypress', onKey);
  });
}
function question(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(label, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}
function saveConfig(config, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Secure the empty file before writing secret bytes.
  const fd = fs.openSync(file, 'wx', 0o600);
  fs.closeSync(fd);
  try {
    if (process.platform === 'win32') {
      const sid = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
        ],
        { encoding: 'utf8', windowsHide: true }
      ).trim();
      if (!/^S-1-[0-9-]+$/.test(sid)) {
        throw new Error('Could not identify the Windows user for file protection.');
      }
      execFileSync('icacls.exe', [file, '/inheritance:r', '/grant:r', `*${sid}:(F)`], {
        stdio: 'pipe',
        windowsHide: true,
      });
    } else {
      fs.chmodSync(file, 0o600);
    }
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          version: 1,
          projectRef: PROJECT_REF,
          anonKey: config.anonKey,
          serviceKey: config.serviceKey,
        },
        null,
        2
      ) + '\n',
      { mode: 0o600 }
    );
  } catch {
    fs.unlinkSync(file);
    throw new Error(
      'Could not protect the local key file. Nothing was saved; use session-only startup or secure environment variables.'
    );
  }
}
async function promptConfig(env = process.env, root = process.cwd()) {
  const file = configPath(env);
  assertExternalConfigPath(file, root);
  console.log(
    `Configure ONLY the temporary project ${PROJECT_REF}. No database setup or writes will run.`
  );
  const anonKey = await hiddenInput('Temporary project public/anon key');
  const serviceKey = await hiddenInput('Temporary project server-only key');
  const config = normalize(
    { url: PROJECT_URL, anonKey, serviceKey, port: env.ISOLATED_PORT },
    'interactive-session'
  );
  console.log(
    'Optional local save: access-restricted file outside the repository; not encrypted. Anyone with access to your OS account can read it.'
  );
  const answer = await question('Save these keys locally for future one-command startup? [y/N] ');
  if (/^y(es)?$/i.test(answer)) {
    if (fs.existsSync(file)) {
      throw new Error(
        'A key file already exists. It was not overwritten. Remove or archive it yourself before reconfiguring.'
      );
    }
    saveConfig(config, file);
    config.source = 'local-file';
    console.log('Saved local isolated configuration. Do not upload or share that file.');
  } else {
    console.log('Session-only mode. Keys will need to be entered next time.');
  }
  return config;
}
module.exports = { hiddenInput, promptConfig, saveConfig };
