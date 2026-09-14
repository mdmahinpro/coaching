import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BUILTIN_ENDPOINTS,
  SAFE_MAPPING_KEYS,
  emptyMessagingConfiguration,
  formatMessagingResult,
  getMessagingProviderConfigs,
  providerConfigurationFor,
  saveMessagingProviderConfig,
  testConfiguredMessagingProvider,
  validateMessagingConfiguration,
  type MessagingChannel,
  type MessagingConfigurationMetadata,
  type MessagingProviderName,
  type MessagingResponse,
  type MessagingValidationIssue,
  type SecretAction,
} from '@/lib/messaging';
import { messagingResultTone } from '@/lib/messagingUi';

type ChannelState = Record<MessagingChannel, MessagingConfigurationMetadata>;
type CustomProviderConfig = Extract<
  MessagingConfigurationMetadata['providerConfig'],
  { providerName: 'custom' }
>;
type BoolByChannel = Record<MessagingChannel, boolean>;
type IssuesByChannel = Record<MessagingChannel, MessagingValidationIssue[]>;
const inputClass = 'input-field min-h-11 w-full min-w-0 max-w-full';
const buttonClass = 'min-h-11 w-full min-w-0 justify-center sm:w-auto';
const labels = {
  sms: { title: 'SMS provider', recipient: '01XXXXXXXXX' },
  email: { title: 'Email provider', recipient: 'student@example.com' },
} satisfies Record<MessagingChannel, { title: string; recipient: string }>;
const providerOptions = (channel: MessagingChannel) =>
  channel === 'sms'
    ? [
        { value: 'mim', label: 'MIM' },
        { value: 'custom', label: 'Custom' },
      ]
    : [
        { value: 'resend', label: 'Resend' },
        { value: 'custom', label: 'Custom' },
      ];
const issueFor = (issues: MessagingValidationIssue[], field: string) =>
  issues.find((issue) => issue.field === field)?.message;
function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 max-w-full text-xs text-slate-400">
      <span className="mb-1.5 block">{label}</span>
      {children}
      {error && (
        <span className="mt-1 block break-words text-red-300" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
function parseScalar(value: string): string | number | boolean | null {
  if (value === 'null') {return null;}
  if (value === 'true') {return true;}
  if (value === 'false') {return false;}
  if (value.trim() && Number.isFinite(Number(value))) {return Number(value);}
  return value;
}

export function MessagingProviderSettings() {
  const [configs, setConfigs] = useState<ChannelState>({
    sms: emptyMessagingConfiguration('sms'),
    email: emptyMessagingConfiguration('email'),
  });
  const [dirty, setDirty] = useState<BoolByChannel>({ sms: false, email: false });
  const [saving, setSaving] = useState<BoolByChannel>({ sms: false, email: false });
  const [testing, setTesting] = useState<BoolByChannel>({ sms: false, email: false });
  const [issues, setIssues] = useState<IssuesByChannel>({ sms: [], email: [] });
  const [secretAction, setSecretAction] = useState<Record<MessagingChannel, SecretAction>>({
    sms: 'preserve',
    email: 'preserve',
  });
  const [replacement, setReplacement] = useState<Record<MessagingChannel, string>>({
    sms: '',
    email: '',
  });
  const [recipient, setRecipient] = useState<Record<MessagingChannel, string>>({
    sms: '',
    email: '',
  });
  const [results, setResults] = useState<Record<MessagingChannel, MessagingResponse | null>>({
    sms: null,
    email: null,
  });
  const [status, setStatus] = useState<Record<MessagingChannel, string>>({ sms: '', email: '' });
  const [dryRunBinding, setDryRunBinding] = useState<Record<MessagingChannel, string | null>>({
    sms: null,
    email: null,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [liveConfirmation, setLiveConfirmation] = useState<{
    channel: MessagingChannel;
    providerName: MessagingProviderName;
    recipient: string;
    configRevision: string;
  } | null>(null);

  const invalidate = (channel: MessagingChannel) => {
    setDirty((current) => ({ ...current, [channel]: true }));
    setResults((current) => ({ ...current, [channel]: null }));
    setDryRunBinding((current) => ({ ...current, [channel]: null }));
    setStatus((current) => ({ ...current, [channel]: '' }));
    setLiveConfirmation((current) => (current?.channel === channel ? null : current));
  };
  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await getMessagingProviderConfigs();
      const byChannel = Object.fromEntries(
        response.configurations.map((item) => [item.channel, item])
      );
      setConfigs({
        sms:
          (byChannel.sms as MessagingConfigurationMetadata | undefined) ??
          emptyMessagingConfiguration('sms'),
        email:
          (byChannel.email as MessagingConfigurationMetadata | undefined) ??
          emptyMessagingConfiguration('email'),
      });
      setDirty({ sms: false, email: false });
      setResults({ sms: null, email: null });
      setDryRunBinding({ sms: null, email: null });
      setSecretAction({ sms: 'preserve', email: 'preserve' });
      setReplacement({ sms: '', email: '' });
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const updateEnabled = (channel: MessagingChannel, enabled: boolean) => {
    setConfigs((current) => ({ ...current, [channel]: { ...current[channel], enabled } }));
    invalidate(channel);
  };
  const updateProviderConfig = (
    channel: MessagingChannel,
    patch: Partial<CustomProviderConfig> | Record<string, unknown>
  ) => {
    setConfigs((current) => ({
      ...current,
      [channel]: {
        ...current[channel],
        providerConfig: {
          ...current[channel].providerConfig,
          ...patch,
        } as MessagingConfigurationMetadata['providerConfig'],
      },
    }));
    invalidate(channel);
  };
  const selectProvider = (channel: MessagingChannel, providerName: MessagingProviderName) => {
    setConfigs((current) => ({
      ...current,
      [channel]: {
        ...current[channel],
        providerName,
        providerConfig: providerConfigurationFor(channel, providerName),
      },
    }));
    setSecretAction((current) => ({ ...current, [channel]: 'replace' }));
    setReplacement((current) => ({ ...current, [channel]: '' }));
    invalidate(channel);
  };
  const requestRemoval = (channel: MessagingChannel) => {
    if (
      configs[channel].credentialConfigured &&
      window.confirm(
        `Remove the saved ${channel.toUpperCase()} credential? Sending will stop until a replacement is saved.`
      )
    ) {
      setSecretAction((current) => ({ ...current, [channel]: 'remove' }));
      setReplacement((current) => ({ ...current, [channel]: '' }));
      invalidate(channel);
    }
  };
  const save = async (channel: MessagingChannel) => {
    const localIssues = validateMessagingConfiguration(configs[channel]);
    if (secretAction[channel] === 'replace' && !replacement[channel])
      {localIssues.push({ field: 'credential', message: 'Enter a replacement credential.' });}
    setIssues((current) => ({ ...current, [channel]: localIssues }));
    if (localIssues.length) {return;}
    setSaving((current) => ({ ...current, [channel]: true }));
    try {
      const saved = await saveMessagingProviderConfig(
        configs[channel],
        secretAction[channel],
        replacement[channel]
      );
      setConfigs((current) => ({ ...current, [channel]: saved }));
      setDirty((current) => ({ ...current, [channel]: false }));
      setDryRunBinding((current) => ({ ...current, [channel]: null }));
      setSecretAction((current) => ({ ...current, [channel]: 'preserve' }));
      setStatus((current) => ({
        ...current,
        [channel]: 'Configuration saved. Run a dry run before live testing.',
      }));
    } catch (error) {
      const safeIssues = (error as { issues?: unknown }).issues;
      setIssues((current) => ({
        ...current,
        [channel]: Array.isArray(safeIssues)
          ? safeIssues
              .filter((item): item is { field: string } =>
                Boolean(
                  item &&
                  typeof item === 'object' &&
                  typeof (item as { field?: unknown }).field === 'string'
                )
              )
              .map((item) => ({ field: item.field, message: 'Server rejected this field.' }))
          : [
              {
                field: 'form',
                message: error instanceof Error ? error.message : 'Configuration was not saved.',
              },
            ],
      }));
    } finally {
      setReplacement((current) => ({ ...current, [channel]: '' }));
      setSaving((current) => ({ ...current, [channel]: false }));
    }
  };
  const runTest = async (
    channel: MessagingChannel,
    live: boolean,
    confirmation?: typeof liveConfirmation
  ) => {
    const config = configs[channel];
    const destination = recipient[channel].trim();
    if (!destination) {
      setIssues((current) => ({
        ...current,
        [channel]: [{ field: 'recipient', message: 'Enter one test recipient.' }],
      }));
      return;
    }
    if (dirty[channel] || !config.configRevision) {
      setIssues((current) => ({
        ...current,
        [channel]: [
          {
            field: 'test',
            message:
              'Save changes before testing; readiness is invalid while configuration is dirty.',
          },
        ],
      }));
      return;
    }
    if (
      live &&
      (!confirmation ||
        confirmation.channel !== channel ||
        confirmation.providerName !== config.providerName ||
        confirmation.recipient !== destination ||
        confirmation.configRevision !== config.configRevision)
    )
      {return;}
    setTesting((current) => ({ ...current, [channel]: true }));
    setResults((current) => ({ ...current, [channel]: null }));
    try {
      const result = await testConfiguredMessagingProvider({
        channel,
        providerName: config.providerName,
        recipient: destination,
        configRevision: config.configRevision,
        live,
      });
      setResults((current) => ({ ...current, [channel]: result }));
      if (!live && !['failed', 'unavailable'].includes(result.status))
        {setDryRunBinding((current) => ({
          ...current,
          [channel]: `${config.providerName}:${destination}:${config.configRevision}`,
        }));}
    } catch {
      setIssues((current) => ({
        ...current,
        [channel]: [
          {
            field: 'test',
            message: 'The provider test failed. Sensitive response details were hidden.',
          },
        ],
      }));
    } finally {
      setTesting((current) => ({ ...current, [channel]: false }));
      setLiveConfirmation(null);
    }
  };
  if (loading)
    {return (
      <div className="card p-5 text-sm text-slate-400">
        <Loader2 className="mr-2 inline animate-spin" size={16} />
        Loading messaging configuration…
      </div>
    );}
  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden" data-testid="messaging-provider-settings">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-semibold text-white">Messaging provider settings</h2>
          <p className="break-words text-xs text-slate-400">
            Admin-only configuration. Saved credentials are write-only and never returned to this
            browser.
          </p>
        </div>
        <button
          type="button"
          className={cn('btn-outline', buttonClass)}
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      {loadError && (
        <p
          className="rounded-lg border border-red-400/30 bg-red-500/5 p-3 text-sm text-red-200"
          role="alert"
        >
          Configuration could not be loaded.
        </p>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
        {(['sms', 'email'] as const).map((channel) => {
          const config = configs[channel];
          const provider = config.providerConfig;
          const custom = provider.providerName === 'custom';
          const channelIssues = issues[channel];
          const result = results[channel];
          const tone = result ? messagingResultTone(result) : 'neutral';
          return (
            <section
              key={channel}
              className="card min-w-0 max-w-full space-y-4 overflow-hidden p-4 sm:p-5"
              data-testid={`${channel}-provider-settings`}
            >
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="font-semibold text-white">{labels[channel].title}</h3>
                  <p className="break-all text-xs text-slate-500">
                    Revision: {config.configRevision || 'not saved'}
                  </p>
                </div>
                <span
                  className={cn(
                    'w-fit rounded-full border px-2 py-1 text-xs',
                    dirty[channel]
                      ? 'border-amber-400/30 text-amber-300'
                      : 'border-emerald-400/30 text-emerald-300'
                  )}
                >
                  {dirty[channel] ? 'Unsaved · readiness invalid' : 'Saved'}
                </span>
              </div>
              <label className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-lg border border-white/10 px-3 text-sm text-slate-200">
                <span>Enabled</span>
                <input
                  aria-label={`${channel.toUpperCase()} enabled`}
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => updateEnabled(channel, e.target.checked)}
                />
              </label>
              <Field label="Provider" error={issueFor(channelIssues, 'providerName')}>
                <select
                  className={inputClass}
                  value={config.providerName}
                  onChange={(e) => selectProvider(channel, e.target.value as MessagingProviderName)}
                >
                  {providerOptions(channel).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              {!custom && (
                <Field label="Endpoint (fixed)">
                  <div className="relative">
                    <input
                      className={cn(inputClass, 'pr-10 text-slate-500')}
                      readOnly
                      value={BUILTIN_ENDPOINTS[config.providerName as 'mim' | 'resend']}
                    />
                    <Lock
                      className="absolute right-3 top-3 text-slate-500"
                      size={16}
                      aria-label="Locked endpoint"
                    />
                  </div>
                </Field>
              )}
              {provider.providerName === 'mim' && (
                <>
                  <Field label="MIM username" error={issueFor(channelIssues, 'userName')}>
                    <input
                      className={inputClass}
                      value={provider.userName}
                      onChange={(e) => updateProviderConfig(channel, { userName: e.target.value })}
                    />
                  </Field>
                  <Field label="Sender name" error={issueFor(channelIssues, 'senderName')}>
                    <input
                      className={inputClass}
                      value={provider.senderName}
                      onChange={(e) =>
                        updateProviderConfig(channel, { senderName: e.target.value })
                      }
                    />
                  </Field>
                </>
              )}
              {provider.providerName === 'resend' && (
                <Field label="From identity" error={issueFor(channelIssues, 'from')}>
                  <input
                    className={inputClass}
                    value={provider.from}
                    onChange={(e) => updateProviderConfig(channel, { from: e.target.value })}
                    placeholder="Coaching Center <mail@example.com>"
                  />
                </Field>
              )}
              {custom && (
                <CustomFields
                  channel={channel}
                  config={provider}
                  issues={channelIssues}
                  update={(patch) => updateProviderConfig(channel, patch)}
                />
              )}
              <div className="min-w-0 rounded-lg border border-white/10 p-3">
                <p className="flex min-w-0 items-center gap-2 break-words text-sm text-slate-200">
                  {config.credentialConfigured ? (
                    <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
                  ) : (
                    <AlertTriangle size={15} className="shrink-0 text-amber-400" />
                  )}
                  Credential {config.credentialConfigured ? 'configured' : 'not configured'}
                  {config.credentialHint ? ` (${config.credentialHint})` : ''}
                </p>
                <p className="mt-1 break-words text-xs text-slate-500">
                  The existing value cannot be viewed. Saving preserves it unless you explicitly
                  replace or remove it.
                </p>
                <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    className={cn('btn-outline', buttonClass)}
                    onClick={() => {
                      setSecretAction((v) => ({ ...v, [channel]: 'replace' }));
                      invalidate(channel);
                    }}
                  >
                    Replace credential
                  </button>
                  {config.credentialConfigured && (
                    <button
                      type="button"
                      className={cn('btn-outline text-red-300', buttonClass)}
                      onClick={() => requestRemoval(channel)}
                    >
                      <Trash2 size={14} />
                      Remove
                    </button>
                  )}
                </div>
                {secretAction[channel] === 'replace' && (
                  <Field
                    label="New credential (write-only)"
                    error={issueFor(channelIssues, 'credential')}
                  >
                    <input
                      type="password"
                      autoComplete="new-password"
                      className={cn(inputClass, 'mt-3')}
                      value={replacement[channel]}
                      onChange={(e) => setReplacement((v) => ({ ...v, [channel]: e.target.value }))}
                    />
                  </Field>
                )}
                {secretAction[channel] === 'remove' && (
                  <p className="mt-2 text-xs text-red-300">
                    Removal confirmed; save this channel to apply.
                  </p>
                )}
              </div>
              {channelIssues
                .filter((issue) => ['form', 'test'].includes(issue.field))
                .map((issue, index) => (
                  <p
                    key={`${issue.field}-${index}`}
                    className="break-words rounded-lg border border-red-400/30 bg-red-500/5 p-3 text-sm text-red-200"
                    role="alert"
                  >
                    {issue.message}
                  </p>
                ))}
              <button
                type="button"
                className={cn('btn-primary', buttonClass)}
                disabled={saving[channel] || !dirty[channel]}
                onClick={() => void save(channel)}
              >
                {saving[channel] ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <Save size={14} />
                )}
                Save {channel.toUpperCase()}
              </button>
              <div className="min-w-0 border-t border-white/10 pt-4">
                <h4 className="text-sm font-medium text-white">Single-recipient test</h4>
                <p className="mb-3 break-words text-xs text-slate-500">
                  Save, run a dry run, then confirm one allowlisted live recipient. Confirmation is
                  bound to channel, provider, recipient and revision.
                </p>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <input
                    className={cn(inputClass, 'sm:flex-1')}
                    value={recipient[channel]}
                    onChange={(e) => {
                      setRecipient((v) => ({ ...v, [channel]: e.target.value }));
                      setLiveConfirmation(null);
                    }}
                    placeholder={labels[channel].recipient}
                  />
                  <button
                    type="button"
                    className={cn('btn-outline', buttonClass)}
                    disabled={
                      testing[channel] ||
                      dirty[channel] ||
                      !config.enabled ||
                      !config.configRevision
                    }
                    onClick={() => void runTest(channel, false)}
                  >
                    {testing[channel] ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Send size={14} />
                    )}
                    Dry run
                  </button>
                  <button
                    type="button"
                    className={cn('btn-outline border-red-400/40 text-red-200', buttonClass)}
                    disabled={
                      testing[channel] ||
                      dirty[channel] ||
                      !config.enabled ||
                      !recipient[channel].trim() ||
                      dryRunBinding[channel] !==
                        `${config.providerName}:${recipient[channel].trim()}:${config.configRevision}`
                    }
                    onClick={() =>
                      setLiveConfirmation({
                        channel,
                        providerName: config.providerName,
                        recipient: recipient[channel].trim(),
                        configRevision: config.configRevision,
                      })
                    }
                  >
                    Live test
                  </button>
                </div>
                {issueFor(channelIssues, 'recipient') && (
                  <p className="mt-1 text-xs text-red-300" role="alert">
                    {issueFor(channelIssues, 'recipient')}
                  </p>
                )}
                {result && (
                  <div
                    className={cn(
                      'mt-3 break-words rounded-lg border p-3 text-sm',
                      tone === 'error'
                        ? 'border-red-400/30 bg-red-500/5 text-red-200'
                        : tone === 'warning'
                          ? 'border-amber-400/30 bg-amber-500/5 text-amber-200'
                          : 'border-emerald-400/30 bg-emerald-500/5 text-emerald-200'
                    )}
                    role="status"
                  >
                    {formatMessagingResult(result)}
                  </div>
                )}
              </div>
              {status[channel] && (
                <p className="break-words text-xs text-emerald-300" role="status">
                  {status[channel]}
                </p>
              )}
            </section>
          );
        })}
      </div>
      {liveConfirmation && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 p-3 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="live-test-title"
        >
          <div className="card my-auto max-h-[calc(100dvh-1.5rem)] w-full min-w-0 max-w-md overflow-y-auto p-5">
            <h3 id="live-test-title" className="font-semibold text-white">
              Confirm live {liveConfirmation.channel.toUpperCase()} test
            </h3>
            <p className="mt-2 break-words text-sm text-slate-300">
              Send through <strong>{liveConfirmation.providerName}</strong> to{' '}
              <strong>{liveConfirmation.recipient}</strong> using revision{' '}
              <strong>{liveConfirmation.configRevision}</strong>?
            </p>
            <p className="mt-2 text-xs text-red-200">
              The server will permit only one allowlisted recipient.
            </p>
            <div className="mt-5 flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className={cn('btn-outline', buttonClass)}
                onClick={() => setLiveConfirmation(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cn('btn-primary bg-red-500', buttonClass)}
                onClick={() => void runTest(liveConfirmation.channel, true, liveConfirmation)}
              >
                Confirm live send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CustomFields({
  channel,
  config,
  issues,
  update,
}: {
  channel: MessagingChannel;
  config: CustomProviderConfig;
  issues: MessagingValidationIssue[];
  update: (patch: Partial<CustomProviderConfig>) => void;
}) {
  const authPlacement = config.auth?.placement ?? 'none';
  return (
    <>
      <Field label="Exact HTTPS endpoint" error={issueFor(issues, 'endpoint')}>
        <input
          className={inputClass}
          value={config.endpoint}
          onChange={(e) => update({ endpoint: e.target.value })}
          placeholder="https://notify.example.com/send"
        />
      </Field>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Authentication placement" error={issueFor(issues, 'auth')}>
          <select
            className={inputClass}
            value={authPlacement}
            onChange={(e) =>
              update({
                auth:
                  e.target.value === 'header'
                    ? { placement: 'header', name: 'Authorization', scheme: 'Bearer ' }
                    : e.target.value === 'body'
                      ? { placement: 'body', path: 'apiKey' }
                      : undefined,
              })
            }
          >
            <option value="none">None</option>
            <option value="header">Header</option>
            <option value="body">Body</option>
          </select>
        </Field>
        {config.auth?.placement === 'header' && (
          <>
            <Field label="Auth header">
              <input
                className={inputClass}
                value={config.auth.name}
                onChange={(e) =>
                  update({
                    auth: {
                      placement: 'header',
                      name: e.target.value,
                      scheme: config.auth?.placement === 'header' ? config.auth.scheme : undefined,
                    },
                  })
                }
              />
            </Field>
            <Field label="Auth scheme">
              <input
                className={inputClass}
                value={config.auth.scheme ?? ''}
                onChange={(e) =>
                  update({
                    auth: {
                      placement: 'header',
                      name:
                        config.auth?.placement === 'header' ? config.auth.name : 'Authorization',
                      scheme: e.target.value,
                    },
                  })
                }
              />
            </Field>
          </>
        )}
        {config.auth?.placement === 'body' && (
          <Field label="Auth body path">
            <input
              className={inputClass}
              value={config.auth.path}
              onChange={(e) => update({ auth: { placement: 'body', path: e.target.value } })}
            />
          </Field>
        )}
      </div>
      <Field label="Idempotency placement" error={issueFor(issues, 'idempotency')}>
        <select
          className={inputClass}
          value={config.idempotency.placement}
          onChange={(e) =>
            update({
              idempotency:
                e.target.value === 'header'
                  ? { placement: 'header', name: 'Idempotency-Key' }
                  : e.target.value === 'body'
                    ? { placement: 'body', path: 'idempotencyKey' }
                    : { placement: 'none' },
            })
          }
        >
          <option value="header">Header</option>
          <option value="body">Body</option>
          <option value="none">None</option>
        </select>
      </Field>
      {config.idempotency.placement === 'none' && (
        <p
          className="flex min-w-0 gap-2 rounded-lg border border-amber-400/30 bg-amber-500/5 p-3 text-xs text-amber-200"
          role="alert"
        >
          <AlertTriangle size={16} className="shrink-0" />
          Without provider idempotency, ambiguous sends cannot be safely retried and may require
          manual review.
        </p>
      )}
      {config.idempotency.placement === 'header' && (
        <Field label="Idempotency header">
          <input
            className={inputClass}
            value={config.idempotency.name}
            onChange={(e) => update({ idempotency: { placement: 'header', name: e.target.value } })}
          />
        </Field>
      )}
      {config.idempotency.placement === 'body' && (
        <Field label="Idempotency body path">
          <input
            className={inputClass}
            value={config.idempotency.path}
            onChange={(e) => update({ idempotency: { placement: 'body', path: e.target.value } })}
          />
        </Field>
      )}
      <div>
        <p className="mb-2 text-xs text-slate-400">Restricted field mappings</p>
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          {SAFE_MAPPING_KEYS[channel].map((semantic) => (
            <Field
              key={semantic}
              label={semantic}
              error={issueFor(issues, `fieldMappings.${semantic}`)}
            >
              <input
                className={inputClass}
                value={config.fieldMappings[semantic] ?? ''}
                onChange={(e) =>
                  update({ fieldMappings: { ...config.fieldMappings, [semantic]: e.target.value } })
                }
              />
            </Field>
          ))}
        </div>
      </div>
      <Field label="Accepted HTTP statuses" error={issueFor(issues, 'acceptedStatuses')}>
        <input
          className={inputClass}
          inputMode="numeric"
          value={config.acceptedStatuses.join(', ')}
          onChange={(e) =>
            update({
              acceptedStatuses: e.target.value.split(',').map(Number).filter(Number.isInteger),
            })
          }
          placeholder="200, 201, 202"
        />
      </Field>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Success path (optional)">
          <input
            className={inputClass}
            value={config.success?.path ?? ''}
            onChange={(e) =>
              update({
                success: e.target.value
                  ? { path: e.target.value, value: config.success?.value ?? true }
                  : undefined,
              })
            }
            placeholder="data.success"
          />
        </Field>
        <Field label="Success value (optional)">
          <input
            className={inputClass}
            value={config.success ? String(config.success.value) : ''}
            onChange={(e) =>
              update({
                success: config.success
                  ? { ...config.success, value: parseScalar(e.target.value) }
                  : { path: '', value: parseScalar(e.target.value) },
              })
            }
            placeholder="true"
          />
        </Field>
        <Field label="Provider ID path">
          <input
            className={inputClass}
            value={config.providerIdPath}
            onChange={(e) => update({ providerIdPath: e.target.value })}
            placeholder="data.id"
          />
        </Field>
        <Field label="Sender identity (optional)">
          <input
            className={inputClass}
            value={config.senderIdentity ?? ''}
            onChange={(e) => update({ senderIdentity: e.target.value || undefined })}
          />
        </Field>
      </div>
    </>
  );
}
export default MessagingProviderSettings;
