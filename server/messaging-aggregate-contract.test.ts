import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(`${process.cwd()}/server/messaging-core.ts`, 'utf8');

function functionBody(name: string, nextName: string): string {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('message aggregate server contract', () => {
  it('refreshJobAggregate uses only the typed atomic RPC, never a delivery SELECT plus job PATCH', () => {
    const body = functionBody('refreshJobAggregate', 'providerJson');
    expect(body).toContain("db('rpc/refresh_message_job_aggregate'");
    expect(body).toContain('AggregateRpcSummary[]');
    expect(body).not.toContain('message_deliveries');
    expect(body).not.toContain('message_jobs');
    expect(body).not.toContain("method: 'PATCH'");
  });

  it('does not redundantly refresh after provider attempts in the queue worker', () => {
    const body = functionBody('processMessagingJobs', 'handleProcessMessagingJobs');
    expect(body).toContain('recordAttempt(');
    expect(body).not.toContain('refreshJobAggregate(');
  });

  it('refreshes through the atomic RPC after Resend webhook and MIM DLR transitions', () => {
    const resend = functionBody('handleResendWebhook', 'mimDlrStatus');
    const mim = functionBody('syncMimDlr', 'handleMimDlrSync');
    expect(resend).toContain('await refreshJobAggregate(jobId)');
    expect(mim).toContain('await refreshJobAggregate(jobId)');
  });

  it('uses a single aggregate refresh only for the immediate inline response after attempts', () => {
    const send = functionBody('sendMessage', 'handleSendSms');
    expect(send.match(/refreshJobAggregate\(/g)).toHaveLength(1);
    expect(send).toContain('return result(200, await refreshJobAggregate(created.summary.jobId)');
  });
});
