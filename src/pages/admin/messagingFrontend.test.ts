import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const admissions = readFileSync(`${process.cwd()}/src/pages/admin/AdmissionsPage.tsx`, 'utf8');
const messaging = readFileSync(`${process.cwd()}/src/pages/admin/SMSPage.tsx`, 'utf8');
const app = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');
const portalLogin = readFileSync(`${process.cwd()}/src/pages/portal/PortalLoginPage.tsx`, 'utf8');
const studentDrawer = readFileSync(
  `${process.cwd()}/src/components/admin/StudentDrawer.tsx`,
  'utf8'
);
const settings = readFileSync(`${process.cwd()}/src/pages/admin/SettingsPage.tsx`, 'utf8');
const providerSettings = readFileSync(
  `${process.cwd()}/src/components/admin/MessagingProviderSettings.tsx`,
  'utf8'
);

describe('messaging frontend regressions', () => {
  it('redirects the unsupported portal signup route and links admission directly', () => {
    expect(app).toContain(
      '<Route path="/portal/signup" element={<Navigate to="/admission" replace />} />'
    );
    expect(app).not.toContain('import PortalSignupPage');
    expect(existsSync(`${process.cwd()}/src/pages/portal/PortalSignupPage.tsx`)).toBe(false);
    expect(portalLogin).toContain('<Link to="/admission"');
    expect(portalLogin).not.toContain('to="/portal/signup"');
  });

  it('does not send a duplicate approval SMS after the atomic approval RPC', () => {
    const approval = admissions.slice(
      admissions.indexOf('const handleApprove'),
      admissions.indexOf('const handleReject')
    );
    expect(approval).toContain("'admin_approve_admission'");
    expect(approval).toContain('notification was queued atomically with approval');
    expect(approval).not.toContain('sendSMS(');
  });

  it('verifies rejection persistence before sending with stable idempotency', () => {
    const rejection = admissions.slice(
      admissions.indexOf('const handleReject'),
      admissions.indexOf('const STAT_CARDS')
    );
    expect(rejection).toContain(".eq('status', 'pending')");
    expect(rejection).toContain(".select('id,status')");
    expect(rejection.indexOf("rejected?.status !== 'rejected'")).toBeLessThan(
      rejection.indexOf('sendSMS(')
    );
    expect(rejection).toContain("messagingIdempotencyKey('admission-rejected', admission.id)");
  });

  it('round-trips templates through site_settings and applies them to the composer', () => {
    expect(messaging).toContain('.upsert({ key: `sms_template_${key}`, value: templates[key] }');
    expect(messaging).toContain(".like('key', 'sms_template_%')");
    expect(messaging).toContain('Apply Template');
    expect(messaging).toContain('initialTemplateKey={appliedTemplateKey}');
  });

  it('uses durable message jobs and deliveries instead of legacy SMS logs', () => {
    const logTab = messaging.slice(
      messaging.indexOf('function SMSLogTab'),
      messaging.indexOf('// ── Settings Tab')
    );
    expect(logTab).toContain(".from('message_jobs')");
    expect(logTab).toContain('unknown_count,created_at,message_deliveries(status)');
    expect(logTab).toContain('{summary.unknown} unknown');
    expect(logTab).not.toContain(".from('sms_logs')");
  });

  it('uses durable message jobs and deliveries for StudentDrawer history', () => {
    expect(studentDrawer).toContain(".from('message_deliveries')");
    expect(studentDrawer).toContain('message_jobs!inner(id,channel,content)');
    expect(studentDrawer).toContain(".eq('message_jobs.channel', 'sms')");
    expect(studentDrawer).toContain('smsHistoryRecipientVariants(studentPhone)');
    expect(studentDrawer).not.toContain(".from('sms_logs')");
  });

  it('uses warning rather than success feedback when queue processing does no work', () => {
    const processQueue = messaging.slice(
      messaging.indexOf('const processQueue'),
      messaging.indexOf('const visibleLogs')
    );
    expect(processQueue).toContain('result.processed > 0');
    expect(processQueue).toContain('no deliveries were processed');
    expect(processQueue).not.toContain('toast.success(`Queue processed: 0');
  });

  it('shows the correct Resend environment names', () => {
    expect(messaging).toContain('`RESEND_API_KEY` and `RESEND_FROM`');
    expect(messaging).not.toContain('`EMAIL_API_KEY` and `EMAIL_FROM`');
  });

  it('uses the same admin-authenticated provider configuration component on both pages', () => {
    expect(messaging).toContain('import { MessagingProviderSettings }');
    expect(settings).toContain('import { MessagingProviderSettings }');
    expect(messaging).toContain('return <MessagingProviderSettings />');
    expect(settings).toContain("{tab === 'sms' && <MessagingProviderSettings />}");
    expect(settings).not.toContain('form.smsProvider');
    expect(settings).not.toContain('form.emailProvider');
  });

  it('keeps channels independent, invalidates dirty results, and warns without idempotency', () => {
    expect(providerSettings).toContain(
      'setResults((current) => ({ ...current, [channel]: null }))'
    );
    expect(providerSettings).toContain('setDirty((current) => ({ ...current, [channel]: true }))');
    expect(providerSettings).toContain('readiness invalid');
    expect(providerSettings).toContain('Without provider idempotency');
  });

  it('uses 320px-safe one-column controls and scroll-safe confirmations', () => {
    expect(providerSettings).toContain('min-h-11 w-full min-w-0');
    expect(providerSettings).toContain('min-h-11 w-full min-w-0 justify-center sm:w-auto');
    expect(providerSettings).toContain('overflow-x-hidden');
    expect(providerSettings).toContain('max-w-full');
    expect(providerSettings).toContain('grid min-w-0 grid-cols-1');
    expect(providerSettings).toContain('overflow-y-auto');
    expect(providerSettings).toContain('max-h-[calc(100dvh-1.5rem)]');
  });

  it('keeps credentials write-only and requires confirmed removal', () => {
    expect(providerSettings).toContain('credentialConfigured');
    expect(providerSettings).toContain('credentialHint');
    expect(providerSettings).toContain('type="password"');
    expect(providerSettings).toContain('window.confirm');
    expect(providerSettings).toContain(
      "setReplacement((current) => ({ ...current, [channel]: '' }))"
    );
    expect(providerSettings).not.toContain('credentialFingerprint');
    expect(providerSettings).not.toContain('localStorage');
  });

  it('separates enabled state from provider selection and exposes all custom fields', () => {
    expect(providerSettings).toContain('checked={config.enabled}');
    expect(providerSettings).not.toContain("value: 'disabled'");
    expect(providerSettings).toContain('Exact HTTPS endpoint');
    expect(providerSettings).toContain('Authentication placement');
    expect(providerSettings).toContain('Idempotency placement');
    expect(providerSettings).toContain('Restricted field mappings');
    expect(providerSettings).toContain('Accepted HTTP statuses');
    expect(providerSettings).toContain('Success path (optional)');
    expect(providerSettings).toContain('Provider ID path');
    expect(providerSettings).toContain('Sender identity (optional)');
  });
});
