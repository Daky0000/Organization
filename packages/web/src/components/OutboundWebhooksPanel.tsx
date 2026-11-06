import React, { useEffect, useState } from 'react';
import { Webhook, Plus, Trash2, Send, CheckCircle2, ShieldCheck } from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';

interface OutboundWebhook {
  id: string;
  name: string;
  target_url: string;
  signing_secret: string;
  events: string[];
  is_active: boolean;
  last_triggered_at: string | null;
  last_status_code: number | null;
}

const AVAILABLE_EVENTS = [
  'lead.created',
  'deal.stage_changed',
  'post.published',
  'approval.decided',
  'survey.submitted',
];

export default function OutboundWebhooksPanel() {
  const [webhooks, setWebhooks] = useState<OutboundWebhook[]>([]);
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    'lead.created',
    'deal.stage_changed',
    'approval.decided',
  ]);
  const [creating, setCreating] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const loadWebhooks = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/webhooks/outbound`);
      const data = await res.json();
      if (data.success) {
        setWebhooks(data.webhooks || []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadWebhooks();
  }, []);

  const toggleEvent = (evt: string) => {
    setSelectedEvents((prev) =>
      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUrl.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/webhooks/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Zapier / Make Endpoint',
          targetUrl,
          events: selectedEvents,
        }),
      });
      const data = await res.json();
      if (data.success && data.webhook) {
        setWebhooks((prev) => [data.webhook, ...prev]);
        setName('');
        setTargetUrl('');
        setStatusNotice('Outbound webhook registered with HMAC-SHA256 signing secret!');
        setTimeout(() => setStatusNotice(null), 4000);
      } else if (data.error) {
        setStatusNotice(`Error: ${data.error}`);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API_BASE_URL}/api/webhooks/outbound/${id}`, { method: 'DELETE' });
    setWebhooks((prev) => prev.filter((w) => w.id !== id));
  };

  const handleTestPing = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/webhooks/outbound/${id}/test`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setStatusNotice(data.message || 'Test ping dispatched!');
        await loadWebhooks();
        setTimeout(() => setStatusNotice(null), 4000);
      }
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5 mt-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Webhook className="h-5 w-5 text-indigo-600" />
            Outbound Webhooks & Event Subscriptions (Zapier / Make / n8n)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Receive real-time HMAC-SHA256 signed JSON payloads (`X-ContentFlow-Signature`) whenever CRM, Post, or Client Approval events fire.
          </p>
        </div>
      </div>

      {statusNotice && (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-indigo-600" />
          {statusNotice}
        </div>
      )}

      <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
        <div className="md:col-span-4">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Endpoint Label</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Make.com CRM Sync"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          />
        </div>
        <div className="md:col-span-5">
          <label className="block text-xs font-semibold text-slate-700 mb-1">HTTPS Target URL</label>
          <input
            type="url"
            required
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://hook.eu1.make.com/..."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          />
        </div>
        <div className="md:col-span-3 flex items-end">
          <button
            type="submit"
            disabled={creating}
            className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {creating ? 'Adding...' : 'Add Webhook'}
          </button>
        </div>

        <div className="md:col-span-12 flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase mr-1">Subscribe Events:</span>
          {AVAILABLE_EVENTS.map((evt) => (
            <button
              key={evt}
              type="button"
              onClick={() => toggleEvent(evt)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition ${
                selectedEvents.includes(evt)
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {evt}
            </button>
          ))}
        </div>
      </form>

      <div className="space-y-2.5">
        {webhooks.map((hook) => (
          <div
            key={hook.id}
            className="p-3.5 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-slate-900">{hook.name}</span>
                {hook.last_status_code && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      hook.last_status_code >= 200 && hook.last_status_code < 300
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    HTTP {hook.last_status_code}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 font-mono truncate max-w-md">{hook.target_url}</div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
                Secret: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{hook.signing_secret.slice(0, 14)}…</code>
                <span>• Events: {(hook.events || []).join(', ')}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={testingId === hook.id}
                onClick={() => void handleTestPing(hook.id)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1"
              >
                <Send className="h-3 w-3" />
                {testingId === hook.id ? 'Pinging...' : 'Test Ping'}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(hook.id)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
