#!/usr/bin/env node
/** Fail closed when a release bundle or checkout contains non-production residue. */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_MARKERS = [
  { label: 'test environment marker', pattern: /(?:VITE_ENVIRONMENT_KIND|ENVIRONMENT_KIND|NODE_ENV|import\.meta\.env\.MODE)[\\"'=: ]+test\b|environment(?:Kind|_kind)[\\"'=: ]+test\b/i },
  { label: 'synthetic project ref', pattern: /(^|[^a-z0-9])(?:aaaaaaaaaaaaaaaaaaaa|abcdefghijklmnopqrst)(?=$|[^a-z0-9])/i },
  { label: 'synthetic/test key', pattern: /(?:sb_publishable_(?:test|your)|test[_-]?key[_-]?for[_-]?(?:unit[_-]?)?tests?|service-role-secret)/i },
];
const DIST_TEST_ARTIFACT = /(?:^|\/)(?:__tests__|coverage|playwright-report|test-results)(?:\/|$)|(?:^|\/)[^/]+\.(?:spec|test)\.[cm]?[jt]sx?$/i;
// Editor-managed mirror worktrees are never part of the checkout being packaged.
const SKIP_DIRS = new Set(['.git', '.kilo', 'node_modules', 'dist']);

function isLocalArtifact(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const base = path.posix.basename(normalized);
  if (base === '.env.example') return false;
  return base === '.env'
    || base.startsWith('.env.')
    || base.endsWith('.log')
    || /(?:^|[-_.])(?:creds|credentials)(?:[-_.]|$)/i.test(base)
    || /\.(?:tmp|temp)$/i.test(base)
    || normalized.split('/').some((part) => part === '.temp' || part === 'tmp' || part === 'temp')
    || normalized === 'e2e/downloads' || normalized.startsWith('e2e/downloads/');
}

async function walk(directory, visitor, relative = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const nextRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        await visitor(path.join(directory, entry.name), nextRelative, true);
        await walk(path.join(directory, entry.name), visitor, nextRelative);
      }
    } else if (entry.isFile()) {
      await visitor(path.join(directory, entry.name), nextRelative, false);
    }
  }
}

export async function auditRelease({ rootDir = root, distDir = path.join(rootDir, 'dist') } = {}) {
  const failures = [];
  try {
    const stat = await fs.stat(distDir);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    failures.push('dist is missing; run a clean production build before packaging');
  }

  if (failures.length === 0) {
    await walk(distDir, async (absolute, relative, isDirectory) => {
      const normalized = relative.split(path.sep).join('/');
      if (DIST_TEST_ARTIFACT.test(normalized)) failures.push(`dist/${normalized}: generated test artifact`);
      if (normalized === 'stats.html') failures.push('dist/stats.html: generated bundle analysis artifact');
      if (isDirectory) return;
      const bytes = await fs.readFile(absolute);
      if (bytes.includes(0)) return;
      const content = bytes.toString('utf8');
      for (const marker of DIST_MARKERS) {
        if (marker.pattern.test(content)) failures.push(`dist/${relative}: ${marker.label}`);
      }
    });
  }

  await walk(rootDir, async (_absolute, relative) => {
    const normalized = relative.split(path.sep).join('/');
    if (normalized === 'stats.html') failures.push('stats.html: generated bundle analysis artifact');
    if (isLocalArtifact(relative)) failures.push(`${relative}: local credential/temp/log artifact`);
  });
  return [...new Set(failures)].sort();
}

export async function removeDist(distDir = path.join(root, 'dist')) {
  await fs.rm(distDir, { recursive: true, force: true });
}

async function main() {
  if (process.argv.includes('--delete-dist')) {
    await removeDist();
    console.log('Removed generated dist before production packaging.');
    return;
  }
  const failures = await auditRelease();
  if (failures.length) throw new Error(`Release cleanliness check failed:\n- ${failures.join('\n- ')}`);
  console.log('Release cleanliness check passed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
