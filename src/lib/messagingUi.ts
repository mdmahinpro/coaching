export interface MessageDeliveryRow {
  status: 'pending' | 'processing' | 'dispatching' | 'accepted' | 'delivered' | 'failed' | 'bounced' | 'unknown' | string;
}

export interface MessageJobRow {
  id: string;
  channel: 'sms' | 'email';
  status: string;
  source_type: string;
  content: { body?: string; subject?: string } | null;
  recipient_count: number;
  accepted_count: number;
  delivered_count: number;
  failed_count: number;
  bounced_count: number;
  unknown_count: number;
  created_at: string;
  message_deliveries?: MessageDeliveryRow[] | null;
}

export type MessageLogStatus = 'queued' | 'processing' | 'accepted' | 'delivered' | 'partial' | 'requires_review' | 'failed';

export const CAMPAIGN_RECIPIENT_LIMIT = 1_000;

export function campaignLimitState(recipientCount: number, unitsPerRecipient = 1) {
  const estimatedUnits = recipientCount * Math.max(1, unitsPerRecipient);
  return {
    recipientCount,
    estimatedUnits,
    overLimit: recipientCount > CAMPAIGN_RECIPIENT_LIMIT,
    message: recipientCount > CAMPAIGN_RECIPIENT_LIMIT
      ? `${recipientCount.toLocaleString()} recipients would cost about ${estimatedUnits.toLocaleString()} message units. The queue limit is ${CAMPAIGN_RECIPIENT_LIMIT.toLocaleString()}; reduce the selection before sending.`
      : `${recipientCount.toLocaleString()} recipients · estimated cost ${estimatedUnits.toLocaleString()} message units`,
  };
}

export type MessagingResultTone = 'success' | 'warning' | 'error' | 'neutral';

export function messagingResultTone(result: { status: string; total: number; accepted: number; failed: number; pending: number; unknown?: number; requiresReview?: boolean }): MessagingResultTone {
  const status = result.status.toLowerCase().replace(/-/g, '_');
  if (status === 'failed' || status === 'unavailable' || (result.total > 0 && result.failed >= result.total)) {
    return 'error';
  }
  if (status === 'partial' || status === 'partially_failed' || status === 'requires_review' || result.requiresReview || (result.unknown ?? 0) > 0 || result.failed > 0) {
    return 'warning';
  }
  if (status === 'completed' && result.total > 0 && result.accepted === result.total && result.failed === 0 && result.pending === 0) {
    return 'success';
  }
  return status === 'queued' || status === 'processing' || status === 'pending' || status === 'dry_run'
    ? 'warning'
    : 'neutral';
}

export function summarizeMessageJob(job: MessageJobRow) {
  const deliveries = job.message_deliveries ?? [];
  const count = (statuses: string[]) => deliveries.filter((delivery) => statuses.includes(delivery.status)).length;
  const total = deliveries.length || job.recipient_count || 0;
  const delivered = deliveries.length ? count(['delivered']) : job.delivered_count || 0;
  const accepted = deliveries.length ? count(['accepted']) : job.accepted_count || 0;
  const failed = deliveries.length ? count(['failed', 'bounced']) : (job.failed_count || 0) + (job.bounced_count || 0);
  const unknown = deliveries.length ? count(['unknown', 'dispatching']) : job.unknown_count || 0;
  const processing = deliveries.length ? count(['processing']) : job.status === 'processing' ? Math.max(0, total - delivered - accepted - failed - unknown) : 0;
  const queued = deliveries.length
    ? count(['pending'])
    : Math.max(0, total - delivered - accepted - failed - unknown - processing);

  let status: MessageLogStatus;
  const persistedStatus = job.status.toLowerCase().replace(/-/g, '_');
  if (persistedStatus === 'requires_review') {
    status = 'requires_review';
  } else if (failed === total && total > 0) {
    status = 'failed';
  } else if (failed > 0 || persistedStatus === 'partially_failed' || persistedStatus === 'partial') {
    status = 'partial';
  } else if (delivered === total && total > 0) {
    status = 'delivered';
  } else if (delivered + accepted === total && total > 0) {
    status = delivered > 0 ? 'delivered' : 'accepted';
  } else if (processing > 0 || (!deliveries.length && job.status === 'processing')) {
    status = 'processing';
  } else {
    status = 'queued';
  }

  return { status, total, queued, processing, accepted, delivered, failed, unknown };
}

export function smsHistoryRecipientVariants(phone: string): string[] {
  const compact = phone.trim().replace(/[^\d+]/g, '').replace(/^\+/, '');
  let normalized = compact;
  if (normalized.startsWith('00880')) {
    normalized = normalized.slice(2);
  } else if (normalized.startsWith('01')) {
    normalized = `88${normalized}`;
  } else if (normalized.startsWith('1')) {
    normalized = `880${normalized}`;
  }
  return [...new Set([phone, compact, normalized].filter(Boolean))];
}

export function savedSmsTemplates(rows: Array<{ key: string; value: unknown }>): Record<string, string> {
  return Object.fromEntries(
    rows
      .filter((row) => row.key.startsWith('sms_template_') && typeof row.value === 'string')
      .map((row) => [row.key.slice('sms_template_'.length), row.value as string])
  );
}
