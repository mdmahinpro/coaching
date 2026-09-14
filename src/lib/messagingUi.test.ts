import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_RECIPIENT_LIMIT,
  campaignLimitState,
  messagingResultTone,
  savedSmsTemplates,
  smsHistoryRecipientVariants,
  summarizeMessageJob,
  type MessageJobRow,
} from './messagingUi';

const job = (statuses: string[], status = 'processing'): MessageJobRow => ({
  id: 'job-1', channel: 'sms', status, source_type: 'api_send', content: { body: 'hello' },
  recipient_count: statuses.length, accepted_count: 0, delivered_count: 0, failed_count: 0,
  bounced_count: 0, unknown_count: 0, created_at: '2026-01-01T00:00:00Z',
  message_deliveries: statuses.map((deliveryStatus) => ({ status: deliveryStatus })),
});

describe('messaging UI data', () => {
  it('loads only persisted SMS templates and removes the setting prefix', () => {
    expect(savedSmsTemplates([
      { key: 'sms_template_NOTICE', value: 'Saved notice' },
      { key: 'center_name', value: 'Ignored' },
      { key: 'sms_template_BAD', value: 42 },
    ])).toEqual({ NOTICE: 'Saved notice' });
  });

  it.each([
    ['01712345678', '8801712345678'],
    ['+8801712345678', '8801712345678'],
    ['008801712345678', '8801712345678'],
  ])('includes persisted 880 history recipient for %s', (phone, persistedRecipient) => {
    expect(smsHistoryRecipientVariants(phone)).toContain(persistedRecipient);
  });

  it('allows 1000 recipients and blocks 1001 with count and cost details', () => {
    expect(CAMPAIGN_RECIPIENT_LIMIT).toBe(1_000);
    expect(campaignLimitState(1_000, 2)).toMatchObject({ overLimit: false, estimatedUnits: 2_000 });
    const blocked = campaignLimitState(1_001, 2);
    expect(blocked).toMatchObject({ overLimit: true, estimatedUnits: 2_002 });
    expect(blocked.message).toContain('1,001 recipients');
    expect(blocked.message).toContain('2,002 message units');
  });

  it.each([
    [{ status: 'failed', total: 2, accepted: 0, failed: 2, pending: 0 }, 'error'],
    [{ status: 'unavailable', total: 1, accepted: 0, failed: 1, pending: 0 }, 'error'],
    [{ status: 'partial', total: 2, accepted: 1, failed: 1, pending: 0 }, 'warning'],
    [{ status: 'requires-review', total: 1, accepted: 0, failed: 0, pending: 1 }, 'warning'],
    [{ status: 'requires_review', total: 1, accepted: 0, failed: 0, pending: 0, unknown: 1, requiresReview: true }, 'warning'],
    [{ status: 'completed', total: 2, accepted: 2, failed: 0, pending: 0 }, 'success'],
    [{ status: 'completed', total: 2, accepted: 1, failed: 0, pending: 1 }, 'neutral'],
  ])('assigns result %j the %s tone', (result, tone) => {
    expect(messagingResultTone(result)).toBe(tone);
  });

  it.each([
    [['pending'], 'queued'],
    [['processing'], 'processing'],
    [['accepted'], 'accepted'],
    [['delivered'], 'delivered'],
    [['delivered', 'failed'], 'partial'],
    [['failed', 'bounced'], 'failed'],
  ])('renders delivery statuses %j as %s with actual counts', (statuses, expected) => {
    const summary = summarizeMessageJob(job(statuses as string[]));
    expect(summary.status).toBe(expected);
    expect(summary.total).toBe((statuses as string[]).length);
    expect(summary.queued + summary.processing + summary.accepted + summary.delivered + summary.failed + summary.unknown).toBe(summary.total);
  });

  it('reports unknown deliveries separately from queued deliveries', () => {
    const summary = summarizeMessageJob(job(['pending', 'unknown'], 'requires_review'));
    expect(summary).toMatchObject({
      status: 'requires_review',
      total: 2,
      queued: 1,
      unknown: 1,
    });
  });

  it('aggregates dispatching as an unknown outcome that requires review', () => {
    const summary = summarizeMessageJob(job(['dispatching'], 'requires_review'));
    expect(summary).toMatchObject({ status: 'requires_review', total: 1, queued: 0, processing: 0, unknown: 1 });
  });

  it('uses persisted unknown counts when a requires-review job has no embedded deliveries', () => {
    const summary = summarizeMessageJob({
      ...job([], 'requires_review'),
      recipient_count: 3,
      unknown_count: 2,
      message_deliveries: [],
    });
    expect(summary).toMatchObject({
      status: 'requires_review',
      total: 3,
      queued: 1,
      unknown: 2,
    });
  });
});
