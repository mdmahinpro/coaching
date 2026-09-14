import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as { crons?: Array<{ path: string; schedule: string }> };
const netlifyQueue = readFileSync(resolve(root, 'netlify/functions/scheduled-process-messaging-jobs.ts'), 'utf8');
const netlifyDlr = readFileSync(resolve(root, 'netlify/functions/scheduled-mim-dlr-sync.ts'), 'utf8');
const netlifyToml = readFileSync(resolve(root, 'netlify.toml'), 'utf8');
const vercelConfigurationRoute = readFileSync(resolve(root, 'api/messaging-configuration.ts'), 'utf8');
const netlifyConfigurationRoute = readFileSync(resolve(root, 'netlify/functions/messaging-configuration.ts'), 'utf8');
const publicWorkers = [
  readFileSync(resolve(root, 'api/process-messaging-jobs.ts'), 'utf8'),
  readFileSync(resolve(root, 'api/mim-dlr-sync.ts'), 'utf8'),
  readFileSync(resolve(root, 'netlify/functions/process-messaging-jobs.ts'), 'utf8'),
  readFileSync(resolve(root, 'netlify/functions/mim-dlr-sync.ts'), 'utf8'),
];

describe('messaging host schedules', () => {
  it('runs the Vercel queue worker frequently and DLR polling every five minutes', () => {
    expect(vercel.crons).toContainEqual({ path: '/api/process-messaging-jobs', schedule: '* * * * *' });
    expect(vercel.crons).toContainEqual({ path: '/api/mim-dlr-sync', schedule: '*/5 * * * *' });
  });

  it('uses authenticated Netlify scheduled entrypoints and preserves failures', () => {
    expect(netlifyQueue).toContain("schedule: '* * * * *'");
    expect(netlifyQueue).toContain("await handleProcessMessagingJobs('POST', `Bearer ${process.env.CRON_SECRET ?? ''}`)");
    expect(netlifyDlr).toContain("schedule: '*/5 * * * *'");
    expect(netlifyDlr).toContain("await handleMimDlrSync('POST', `Bearer ${process.env.CRON_SECRET ?? ''}`)");
    for (const source of [netlifyQueue, netlifyDlr]) {
      expect(source).toContain('status: value.status');
      expect(source).not.toMatch(/fetch\s*\(/);
      expect(source).not.toMatch(/await (?:processMessagingJobs|syncMimDlr)\(\)/);
    }
  });

  it('routes every public queue and DLR host endpoint through environment and worker authentication', () => {
    for (const source of publicWorkers) {
      expect(source).toMatch(/handle(?:ProcessMessagingJobs|MimDlrSync)\(/);
      expect(source).toMatch(/authorization|Authorization/);
      expect(source).toMatch(/x-worker-secret|X-Worker-Secret/);
      expect(source).not.toMatch(/await (?:processMessagingJobs|syncMimDlr)\(\)/);
    }
  });

  it('exposes equivalent admin messaging-configuration routes on Vercel and Netlify', () => {
    expect(netlifyToml).toContain('from   = "/api/messaging-configuration"');
    expect(netlifyToml).toContain('to     = "/.netlify/functions/messaging-configuration"');
    for (const source of [vercelConfigurationRoute, netlifyConfigurationRoute]) {
      expect(source).toContain('handleMessagingConfiguration');
      expect(source).toMatch(/authorization|Authorization/);
      expect(source).toMatch(/query.*channel|queryStringParameters.*channel/);
    }
  });
});
