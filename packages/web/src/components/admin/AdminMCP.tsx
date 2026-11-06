import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Plug, Plus, RefreshCw, Trash2, X, Zap } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

// ─────────────────────────────────────────────────────────────────────────────
// Admin → MCP. Manage Model Context Protocol server connections. Each server
// is configured with a transport (stdio command or HTTP URL) plus secret env
// vars / headers; "Test" connects and lists tools; adapters (MeiGen) also get
// a "Sync now" that pulls gallery media into the AI Studio Discover feed.
// ─────────────────────────────────────────────────────────────────────────────

type McpServer = {
  id: string;
  name: string;
  slug: string;
  transport: 'stdio' | 'http';
  command: string | null;
  args: string[];
  url: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  status: string;
  status_message: string | null;
  last_checked_at: string | null;
  last_synced_at: string | null;
  env_keys: Record<string, string>;
  header_keys: Record<string, string>;
};

const tok = () => localStorage.getItem('auth_token') ?? '';
const hdrs = () => ({ Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json' });

type EnvRow = { key: string; value: string };

export default function AdminMCP() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${action}:${id}`
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/mcp/servers`, { headers: hdrs() });
      const d = await r.json();
      if (!d?.success) throw new Error(d?.error || 'Failed to load');
      setServers(d.servers);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load MCP servers');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: 'test' | 'sync' | 'delete' | 'toggle', server?: McpServer) => {
    setBusy(`${action}:${id}`);
    setMsg(null);
    try {
      if (action === 'delete') {
        if (!window.confirm('Delete this MCP server? Synced media from it will also be removed.')) { setBusy(null); return; }
        const r = await fetch(`${API_BASE_URL}/api/admin/mcp/servers/${id}`, { method: 'DELETE', headers: hdrs() });
        const d = await r.json();
        if (!d?.success) throw new Error(d?.error || 'Delete failed');
        setMsg({ ok: true, text: 'Server deleted.' });
      } else if (action === 'toggle' && server) {
        const r = await fetch(`${API_BASE_URL}/api/admin/mcp/servers/${id}`, {
          method: 'PUT', headers: hdrs(), body: JSON.stringify({ enabled: !server.enabled }),
        });
        const d = await r.json();
        if (!d?.success) throw new Error(d?.error || 'Update failed');
        setMsg({ ok: true, text: server.enabled ? 'Server disabled.' : 'Server enabled — it will sync on the next scheduled scan.' });
      } else {
        const r = await fetch(`${API_BASE_URL}/api/admin/mcp/servers/${id}/${action}`, { method: 'POST', headers: hdrs() });
        const d = await r.json();
        if (!d?.success) throw new Error(d?.error || `${action} failed`);
        if (action === 'test') setMsg({ ok: true, text: `Connected — ${d.tools?.length ?? 0} tools available: ${(d.tools ?? []).map((t: any) => t.name).slice(0, 8).join(', ')}` });
        if (action === 'sync') setMsg({ ok: true, text: `Sync complete — stored ${d.stored} of ${d.scanned} scanned items${d.errors?.length ? ` (${d.errors.length} errors)` : ''}` });
      }
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : `${action} failed` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-[-0.02em] text-slate-950">MCP Servers</h2>
          <p className="mt-1 text-sm text-slate-500">
            Connect Model Context Protocol servers. Configure the transport and secrets, test the connection,
            and enabled media adapters (like MeiGen) feed the AI Studio Discover gallery automatically every 6 hours.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
        >
          <Plus size={14} /> Add server
        </button>
      </div>

      {msg && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {servers === null && !error && (
        <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-slate-300" /></div>
      )}

      <div className="grid gap-4">
        {servers?.map((s) => (
          <div key={s.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.enabled ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                  <Plug size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black text-slate-950">{s.name}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">{s.transport}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                      s.status === 'ok' ? 'bg-emerald-50 text-emerald-600'
                      : s.status === 'error' ? 'bg-red-50 text-red-600'
                      : 'bg-amber-50 text-amber-600'
                    }`}>{s.status}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {s.transport === 'http' ? (s.url || 'No URL set') : `${s.command ?? ''} ${(s.args || []).join(' ')}`.trim() || 'No command set'}
                  </p>
                  {s.status_message && <p className="mt-0.5 text-xs text-slate-400">{s.status_message}</p>}
                  {s.last_synced_at && <p className="mt-0.5 text-[11px] text-slate-400">Last media sync: {new Date(s.last_synced_at).toLocaleString()}</p>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void act(s.id, 'toggle', s)} disabled={busy !== null}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${s.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                  {busy === `toggle:${s.id}` ? <Loader2 size={12} className="animate-spin" /> : s.enabled ? 'Enabled' : 'Disabled'}
                </button>
                <button type="button" onClick={() => void act(s.id, 'test')} disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  {busy === `test:${s.id}` ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Test
                </button>
                {(s.config as any)?.adapter === 'meigen' && (
                  <button type="button" onClick={() => void act(s.id, 'sync')} disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50">
                    {busy === `sync:${s.id}` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync now
                  </button>
                )}
                <button type="button" onClick={() => setEditing(s)} disabled={busy !== null}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  Configure
                </button>
                <button type="button" onClick={() => void act(s.id, 'delete')} disabled={busy !== null}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {servers !== null && servers.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-sm text-slate-400">
            No MCP servers yet. Add one to get started.
          </div>
        )}
      </div>

      {editing && (
        <ServerEditor
          server={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); setMsg({ ok: true, text: 'Server saved.' }); }}
        />
      )}
    </div>
  );
}

function ServerEditor({ server, onClose, onSaved }: { server: McpServer | null; onClose: () => void; onSaved: () => void }) {
  // MeiGen needs exactly one secret; show a single labeled token field
  // instead of the generic key/value editor.
  const isMeigen = server?.slug === 'meigen' || (server?.config as any)?.adapter === 'meigen';
  const [name, setName] = useState(server?.name ?? '');
  const [slug, setSlug] = useState(server?.slug ?? '');
  const [transport, setTransport] = useState<'stdio' | 'http'>(server?.transport ?? 'stdio');
  const [command, setCommand] = useState(server?.command ?? 'npx');
  const [argsText, setArgsText] = useState((server?.args ?? []).join(' '));
  const [url, setUrl] = useState(server?.url ?? '');
  const [envRows, setEnvRows] = useState<EnvRow[]>(() => {
    const keys = Object.keys(server?.env_keys ?? {});
    if (keys.length) return keys.map(k => ({ key: k, value: '••••••' }));
    return [{ key: !server || isMeigen ? 'MEIGEN_API_TOKEN' : '', value: '' }];
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const meigenToken = envRows.find(r => r.key === 'MEIGEN_API_TOKEN');
  const hasSavedMeigenToken = Boolean(server?.env_keys?.MEIGEN_API_TOKEN);
  const setMeigenToken = (value: string) => {
    setEnvRows(rows => {
      const others = rows.filter(r => r.key !== 'MEIGEN_API_TOKEN');
      return [{ key: 'MEIGEN_API_TOKEN', value }, ...others];
    });
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const env: Record<string, string> = {};
      for (const row of envRows) if (row.key.trim()) env[row.key.trim()] = row.value;
      const body: Record<string, unknown> = {
        name: name.trim(), slug: slug.trim().toLowerCase(), transport,
        command: transport === 'stdio' ? command.trim() : null,
        args: transport === 'stdio' ? argsText.split(/\s+/).filter(Boolean) : [],
        url: transport === 'http' ? url.trim() : null,
        env,
      };
      const r = await fetch(
        server ? `${API_BASE_URL}/api/admin/mcp/servers/${server.id}` : `${API_BASE_URL}/api/admin/mcp/servers`,
        { method: server ? 'PUT' : 'POST', headers: hdrs(), body: JSON.stringify(body) }
      );
      const d = await r.json();
      if (!d?.success) throw new Error(d?.error || 'Save failed');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-black text-slate-950">{server ? `Configure ${server.name}` : 'Add MCP server'}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-4 px-6 py-5">
          {err && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name
              <input value={name} onChange={e => setName(e.target.value)} placeholder="MeiGen AI Design" className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`} />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Slug
              <input value={slug} onChange={e => setSlug(e.target.value)} placeholder="meigen" disabled={!!server} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal disabled:opacity-60`} />
            </label>
          </div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Transport
            <select value={transport} onChange={e => setTransport(e.target.value as 'stdio' | 'http')} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`}>
              <option value="stdio">stdio — run a local command</option>
              <option value="http">HTTP — connect to a remote URL</option>
            </select>
          </label>
          {transport === 'stdio' ? (
            <div className="grid grid-cols-3 gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Command
                <input value={command} onChange={e => setCommand(e.target.value)} placeholder="npx" className={`${inputCls} mt-1.5 font-mono normal-case tracking-normal`} />
              </label>
              <label className="col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Arguments
                <input value={argsText} onChange={e => setArgsText(e.target.value)} placeholder="-y meigen-ai-design-mcp" className={`${inputCls} mt-1.5 font-mono normal-case tracking-normal`} />
              </label>
            </div>
          ) : (
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Server URL
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" className={`${inputCls} mt-1.5 font-mono normal-case tracking-normal`} />
            </label>
          )}
          {isMeigen ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">MeiGen API token</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Paste the API key from <span className="font-semibold">meigen.ai → Settings → API Keys</span>. Stored encrypted.
                {hasSavedMeigenToken ? ' A token is already saved — leave the •••••• untouched to keep it.' : ''}
              </p>
              <input
                value={meigenToken?.value ?? ''}
                type="password"
                onChange={e => setMeigenToken(e.target.value)}
                placeholder="meigen_sk_…"
                className={`${inputCls} mt-2 font-mono text-xs`}
              />
            </div>
          ) : (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Environment variables (secrets)</p>
              <p className="mt-0.5 text-[11px] text-slate-400">Left field = variable name, right field = its secret value. Stored encrypted. Existing values show as •••••• — leave them unchanged to keep them.</p>
              <div className="mt-2 space-y-2">
                {envRows.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={row.key} onChange={e => setEnvRows(rows => rows.map((r, j) => j === i ? { ...r, key: e.target.value } : r))}
                      placeholder="VARIABLE_NAME" className={`${inputCls} flex-1 font-mono text-xs`} />
                    <input value={row.value} type="password" onChange={e => setEnvRows(rows => rows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                      placeholder="secret value" className={`${inputCls} flex-1 font-mono text-xs`} />
                    <button type="button" onClick={() => setEnvRows(rows => rows.filter((_, j) => j !== i))}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setEnvRows(rows => [...rows, { key: '', value: '' }])}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700">
                  <Plus size={12} /> Add variable
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving || !name.trim() || !slug.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
