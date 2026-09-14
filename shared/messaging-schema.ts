export type MessagingChannel = 'sms' | 'email';
export type MessagingProviderName = 'mim' | 'resend' | 'custom';
export type MessagingJobStatus = 'queued' | 'processing' | 'completed' | 'partial' | 'failed' | 'requires_review' | 'dry_run';
export type MessagingDeliveryStatus = 'pending' | 'processing' | 'dispatching' | 'accepted' | 'delivered' | 'failed' | 'bounced' | 'unknown';
export type MessagingReadinessState = 'unavailable' | 'configured' | 'live-ready';
export type SecretAction = 'preserve' | 'replace' | 'remove';
export type CanonicalMessageField = 'recipient' | 'message' | 'subject' | 'html' | 'text' | 'sender';

export type CustomAuthConfiguration =
  | { placement: 'header'; name: string; scheme?: string }
  | { placement: 'body'; path: string };
export type CustomIdempotencyConfiguration =
  | { placement: 'header'; name: string }
  | { placement: 'body'; path: string }
  | { placement: 'none' };

export interface CustomProviderConfiguration {
  providerName: 'custom';
  endpoint: string;
  method: 'POST';
  auth?: CustomAuthConfiguration;
  idempotency: CustomIdempotencyConfiguration;
  fieldMappings: Partial<Record<CanonicalMessageField, string>>;
  acceptedStatuses: number[];
  success?: { path: string; value: string | number | boolean | null };
  providerIdPath: string;
  senderIdentity?: string;
}

export type MessagingProviderConfiguration =
  | { providerName: 'mim'; userName: string; senderName: string }
  | { providerName: 'resend'; from: string }
  | CustomProviderConfiguration;

export interface MessagingConfigurationMetadata {
  channel: MessagingChannel;
  providerName: MessagingProviderName;
  enabled: boolean;
  providerConfig: MessagingProviderConfiguration;
  configRevision: string;
  credentialConfigured: boolean;
  credentialFingerprint?: string;
  credentialHint?: string;
  updatedAt?: string;
}

export interface MessagingConfigurationPutRequest {
  channel: MessagingChannel;
  providerName: MessagingProviderName;
  enabled: boolean;
  providerConfig: Record<string, unknown>;
  secretAction: SecretAction;
  secret?: string | Record<string, unknown>;
}

export interface MessagingSendResult {
  jobId: string;
  status: MessagingJobStatus | 'unavailable';
  total: number;
  accepted: number;
  failed: number;
  pending: number;
  unknown: number;
  requiresReview: boolean;
  dryRun: boolean;
}

export interface SmsSendRequest { phones: string[]; message: string; dryRun?: boolean; queue?: boolean; }
export interface EmailSendRequest { emails: string[]; subject: string; html: string; templateType?: string; dryRun?: boolean; queue?: boolean; }
export interface MessagingTestSendRequest { channel: MessagingChannel; recipient: string; confirmRealSend?: boolean; dryRun?: boolean; message?: string; subject?: string; html?: string; }
export interface MessagingReadiness { status: MessagingReadinessState; sms: MessagingReadinessState; email: MessagingReadinessState; persistence: MessagingReadinessState; }
