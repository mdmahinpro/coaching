import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Save, Send, Smartphone, KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/utils/errorHandler';

export const DEFAULT_ZENDSMS_URL = 'https://api.zendsms.com/api/simple/send';

interface GatewayForm {
  provider: 'zendsms' | 'custom';
  baseUrl: string;
  senderId: string;
  method: 'GET' | 'POST';
}

const EMPTY: GatewayForm = { provider: 'zendsms', baseUrl: '', senderId: '', method: 'GET' };

/**
 * Admin → Settings → SMS.
 *
 * Lets the centre point the app at any HTTP SMS gateway (base URL + sender ID +
 * API key) instead of relying on server env vars. The credentials live in the
 * admin-only `sms_gateway_config` table; the server reads them per send and
 * falls back to SMS_API_KEY/SMS_SENDER_ID when no key is saved here.
 */
export function SmsGatewayForm() {
  const [form, setForm] = useState<GatewayForm>(EMPTY);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('sms_gateway_config')
        .select('provider, base_url, sender_id, api_key, http_method')
        .eq('id', 1)
        .maybeSingle();
      if (!alive) return;
      if (error) {
        // Most likely the migration has not been run yet.
        setTableMissing(true);
      } else if (data) {
        setForm({
          provider: data.provider === 'custom' ? 'custom' : 'zendsms',
          baseUrl: data.base_url ?? '',
          senderId: data.sender_id ?? '',
          method: data.http_method === 'POST' ? 'POST' : 'GET',
        });
        setHasKey(Boolean(data.api_key && String(data.api_key).trim()));
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    if (!form.baseUrl.trim()) {
      toast.error('Base URL is required');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        id: 1,
        provider: form.provider,
        base_url: form.baseUrl.trim(),
        sender_id: form.senderId.trim(),
        http_method: form.method,
        updated_at: new Date().toISOString(),
      };
      // Blank key field = "keep the saved one" (so the browser never holds it).
      if (apiKey.trim()) payload.api_key = apiKey.trim();

      const { error } = await supabase
        .from('sms_gateway_config')
        .upsert(payload, { onConflict: 'id' });
      if (error) {
        if (error.code === '42P01') {
          setTableMissing(true);
          toast.error('Run supabase/sms_gateway_config.sql first');
        } else {
          handleSupabaseError(error);
        }
        return;
      }
      if (apiKey.trim()) setHasKey(true);
      setApiKey('');
      setTableMissing(false);
      toast.success('SMS gateway saved');
    } catch (err) {
      handleSupabaseError(err);
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('sms_gateway_config')
        .update({ api_key: null, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (error) {
        handleSupabaseError(error);
        return;
      }
      setHasKey(false);
      toast.success('Saved key removed — falling back to server env vars');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-5 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 size={14} className="animate-spin" /> Loading gateway…
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-4">
      <h3 className="font-semibold text-white text-sm flex items-center gap-2">
        <Smartphone size={15} className="text-violet-400" /> SMS Gateway
      </h3>

      {tableMissing && (
        <div className="card-glass p-3 text-xs text-amber-300 leading-relaxed">
          The <code>sms_gateway_config</code> table does not exist yet. Run{' '}
          <code className="text-sky-400">supabase/sms_gateway_config.sql</code> in the Supabase SQL
          editor, then reload this page. Until then the server uses{' '}
          <code className="text-sky-400">SMS_API_KEY</code> /{' '}
          <code className="text-sky-400">SMS_SENDER_ID</code>.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Provider</label>
          <select
            className="input-field"
            value={form.provider}
            onChange={(e) => {
              const provider = e.target.value as 'zendsms' | 'custom';
              setForm((f) => ({
                ...f,
                provider,
                baseUrl:
                  provider === 'zendsms' && !f.baseUrl.trim() ? DEFAULT_ZENDSMS_URL : f.baseUrl,
              }));
            }}
          >
            <option value="zendsms">ZenSMS (or compatible)</option>
            <option value="custom">Custom gateway</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Request method</label>
          <select
            className="input-field"
            value={form.method}
            onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as 'GET' | 'POST' }))}
          >
            <option value="GET">GET (query params)</option>
            <option value="POST">POST (JSON body)</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="text-xs text-slate-400 mb-1.5 block">Base URL / API endpoint</label>
          <input
            className="input-field font-mono text-xs"
            value={form.baseUrl}
            onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
            placeholder={DEFAULT_ZENDSMS_URL}
            spellCheck={false}
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Sender ID</label>
          <input
            className="input-field"
            value={form.senderId}
            onChange={(e) => setForm((f) => ({ ...f, senderId: e.target.value }))}
            placeholder="8809612781000"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">
            API key {hasKey && <span className="text-emerald-400">— saved</span>}
          </label>
          <input
            className="input-field font-mono text-xs"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder={hasKey ? '•••••••• (leave blank to keep)' : 'Paste the gateway API key'}
          />
        </div>
      </div>

      <div className="card-glass p-3 text-xs text-slate-400 leading-relaxed">
        <p>
          Sent as <code className="text-sky-400">api_key</code>,{' '}
          <code className="text-sky-400">sender_id</code>, <code className="text-sky-400">to</code>,{' '}
          <code className="text-sky-400">message</code> — as query params for GET, as a JSON body
          for POST (the key is also sent as a Bearer header).
        </p>
        <p className="mt-1">
          The key is stored in the admin-only <code>sms_gateway_config</code> table and is never
          included in the browser bundle or readable by non-admins.
        </p>
        {!hasKey && (
          <p className="mt-1 text-amber-300">
            No key saved here — the server falls back to SMS_API_KEY / SMS_SENDER_ID env vars.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={saving} className="btn-primary text-sm px-4">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save gateway
        </button>
        {hasKey && (
          <button onClick={removeKey} disabled={saving} className="btn-outline text-sm px-4">
            <KeyRound size={13} /> Remove saved key
          </button>
        )}
        <a href="/admin/sms" className="btn-outline text-sm px-4 inline-flex items-center gap-1.5">
          <Send size={13} /> Open SMS Center
        </a>
      </div>
    </div>
  );
}
