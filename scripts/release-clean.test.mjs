import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditRelease, removeDist } from './release-clean.mjs';

const roots = [];
async function fixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'release-clean-'));
  roots.push(rootDir);
  const distDir = path.join(rootDir, 'dist');
  await fs.mkdir(distDir);
  await fs.writeFile(path.join(distDir, 'index.html'), '<h1>production</h1>');
  return { rootDir, distDir };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('release cleanliness gate', () => {
  it('accepts a clean production bundle', async () => {
    const paths = await fixture();
    await expect(auditRelease(paths)).resolves.toEqual([]);
  });

  it.each([
    ['test environment marker', 'VITE_ENVIRONMENT_KIND="test"'],
    ['test environment marker', 'NODE_ENV="test"'],
    ['synthetic project ref', 'aaaaaaaaaaaaaaaaaaaa'],
    ['synthetic/test key', 'sb_publishable_test_key_for_unit_tests_only'],
  ])('rejects %s in dist', async (label, marker) => {
    const paths = await fixture();
    await fs.writeFile(path.join(paths.distDir, 'assets.js'), marker);
    await expect(auditRelease(paths)).resolves.toContain(`dist/assets.js: ${label}`);
  });

  it.each(['.env.local', 'operator-creds.json', 'debug.log', 'scratch.tmp'])(
    'rejects local artifact %s', async (name) => {
      const paths = await fixture();
      await fs.writeFile(path.join(paths.rootDir, name), 'local-only');
      const failures = await auditRelease(paths);
      expect(failures.some((failure) => failure.startsWith(`${name}:`))).toBe(true);
    }
  );

  it('rejects the legacy generated root bundle analysis', async () => {
    const paths = await fixture();
    await fs.writeFile(path.join(paths.rootDir, 'stats.html'), '<h1>bundle analysis</h1>');
    await expect(auditRelease(paths)).resolves.toContain('stats.html: generated bundle analysis artifact');
  });

  it('ignores editor-managed .kilo mirror worktrees during packaging checks', async () => {
    const paths = await fixture();
    const mirror = path.join(paths.rootDir, '.kilo', 'worktrees', 'editor-copy');
    await fs.mkdir(mirror, { recursive: true });
    await fs.writeFile(path.join(mirror, '.env.local'), 'mirror-only');
    await expect(auditRelease(paths)).resolves.toEqual([]);
  });

  it('accepts opt-in bundle analysis outside the release directory', async () => {
    const paths = await fixture();
    const analysisFile = path.join(paths.rootDir, 'analysis', 'bundle', 'stats.html');
    await fs.mkdir(path.dirname(analysisFile), { recursive: true });
    await fs.writeFile(analysisFile, '<h1>bundle analysis</h1>');
    await expect(auditRelease(paths)).resolves.toEqual([]);
  });

  it('rejects bundle analysis emitted into dist', async () => {
    const paths = await fixture();
    await fs.writeFile(path.join(paths.distDir, 'stats.html'), '<h1>bundle analysis</h1>');
    await expect(auditRelease(paths)).resolves.toContain('dist/stats.html: generated bundle analysis artifact');
  });

  it.each(['assets/app.test.js', 'test-results/results.json', 'coverage/index.html'])(
    'rejects generated dist test artifact %s', async (relative) => {
      const paths = await fixture();
      const absolute = path.join(paths.distDir, relative);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, 'generated test output');
      await expect(auditRelease(paths)).resolves.toContain(`dist/${relative}: generated test artifact`);
    }
  );

  it('deletes generated dist before packaging', async () => {
    const paths = await fixture();
    await removeDist(paths.distDir);
    await expect(fs.stat(paths.distDir)).rejects.toThrow();
  });
});
