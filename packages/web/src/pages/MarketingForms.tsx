import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ClipboardCopy,
  Code,
  ExternalLink,
  FileText,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../services/apiClient';
import { API_BASE_URL } from '../utils/apiBase';

// ─────────────────────────────────────────────────────────────────────────────
// Marketing → Forms: build lead-capture forms hosted at /f/:id, embeddable on
// any site via iframe. Submissions land in Contacts and fire automations.
// ─────────────────────────────────────────────────────────────────────────────

type FormField = { key: string; label: string; type: 'text' | 'email' | 'tel' | 'textarea'; required: boolean };

type FormSettings = {
  title?: string | null;
  description?: string | null;
  button_text?: string | null;
  success_message?: string | null;
  theme_color?: string | null;
  tags?: string[] | null;
};

type LeadForm = {
  id: string;
  name: string;
  fields: FormField[];
  settings: FormSettings;
  status: 'active' | 'paused';
  submissions_count: number;
  created_at: string;
  updated_at: string;
};

const STANDARD_OPTIONAL: { key: string; label: string; type: FormField['type'] }[] = [
  { key: 'first_name', label: 'First name', type: 'text' },
  { key: 'last_name', label: 'Last name', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'tel' },
];

const inputCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none';

function formUrl(id: string): string {
  return `${API_BASE_URL}/f/${id}`;
}

function embedSnippet(id: string): string {
  return `<iframe src="${formUrl(id)}" width="100%" height="420" frameborder="0" style="border:0;max-width:480px"></iframe>`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white"
    >
      {copied ? <Check size={12} /> : <ClipboardCopy size={12} />} {copied ? 'Copied' : label}
    </button>
  );
}

function FormEditor({ form, onSaved, onClose }: { form: LeadForm | null; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = useState(form?.name ?? '');
  const [title, setTitle] = useState(form?.settings?.title ?? '');
  const [description, setDescription] = useState(form?.settings?.description ?? '');
  const [buttonText, setButtonText] = useState(form?.settings?.button_text ?? '');
  const [successMessage, setSuccessMessage] = useState(form?.settings?.success_message ?? '');
  const [themeColor, setThemeColor] = useState(form?.settings?.theme_color ?? '#2563EB');
  const [tags, setTags] = useState((form?.settings?.tags ?? []).join(', '));
  const [enabledStandard, setEnabledStandard] = useState<Record<string, boolean>>(() => {
    const keys = new Set((form?.fields ?? []).map((f) => f.key));
    return Object.fromEntries(STANDARD_OPTIONAL.map((f) => [f.key, keys.has(f.key)]));
  });
  const [customFields, setCustomFields] = useState<FormField[]>(
    (form?.fields ?? []).filter((f) => f.key !== 'email' && !STANDARD_OPTIONAL.some((s) => s.key === f.key))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) { setError('Form name is required'); return; }
    setSaving(true);
    setError(null);
    const fields: FormField[] = [
      { key: 'email', label: 'Email', type: 'email', required: true },
      ...STANDARD_OPTIONAL.filter((f) => enabledStandard[f.key]).map((f) => ({ ...f, required: false })),
      ...customFields.filter((f) => f.key.trim() && f.label.trim()),
    ];
    const payload = {
      name: name.trim(),
      fields,
      settings: {
        title: title.trim() || null,
        description: description.trim() || null,
        button_text: buttonText.trim() || null,
        success_message: successMessage.trim() || null,
        theme_color: /^#[0-9a-fA-F]{6}$/.test(themeColor) ? themeColor : null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
      },
    };
    try {
      if (form) await api.put(`/api/forms/${form.id}`, payload);
      else await api.post('/api/forms', payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save form');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-black text-slate-950">{form ? 'Edit form' : 'New form'}</h2>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={15} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block text-xs font-bold text-slate-600">Form name (internal)
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Newsletter signup" className={`mt-1.5 ${inputCls}`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold text-slate-600">Headline
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Stay in touch" className={`mt-1.5 ${inputCls}`} />
            </label>
            <label className="block text-xs font-bold text-slate-600">Button text
              <input type="text" value={buttonText} onChange={(e) => setButtonText(e.target.value)} placeholder="Subscribe" className={`mt-1.5 ${inputCls}`} />
            </label>
          </div>
          <label className="block text-xs font-bold text-slate-600">Description
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Get our best tips in your inbox, once a week." className={`mt-1.5 ${inputCls} resize-none`} />
          </label>
          <label className="block text-xs font-bold text-slate-600">Success message
            <input type="text" value={successMessage} onChange={(e) => setSuccessMessage(e.target.value)} placeholder="Thanks — you're on the list!" className={`mt-1.5 ${inputCls}`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold text-slate-600">Brand color
              <div className="mt-1.5 flex items-center gap-2">
                <input type="color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200" />
                <input type="text" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className={inputCls} />
              </div>
            </label>
            <label className="block text-xs font-bold text-slate-600">Tags to apply (comma-separated)
              <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="newsletter, website" className={`mt-1.5 ${inputCls}`} />
            </label>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-600">Fields</p>
            <p className="mt-1 text-xs text-slate-400">Email is always included and required.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {STANDARD_OPTIONAL.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setEnabledStandard((p) => ({ ...p, [f.key]: !p[f.key] }))}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${enabledStandard[f.key] ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                >
                  {enabledStandard[f.key] ? '✓ ' : '+ '}{f.label}
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              {customFields.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="text" value={f.label} onChange={(e) => {
                    const label = e.target.value;
                    setCustomFields((p) => p.map((x, j) => j === i ? { ...x, label, key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) } : x));
                  }} placeholder="Field label (e.g. Company)" className={inputCls} />
                  <select value={f.type} onChange={(e) => setCustomFields((p) => p.map((x, j) => j === i ? { ...x, type: e.target.value as FormField['type'] } : x))} className="rounded-lg border border-slate-200 px-2 py-2 text-sm">
                    <option value="text">Text</option>
                    <option value="tel">Phone</option>
                    <option value="textarea">Long text</option>
                  </select>
                  <button type="button" onClick={() => setCustomFields((p) => p.filter((_, j) => j !== i))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              ))}
              {customFields.length < 8 && (
                <button type="button" onClick={() => setCustomFields((p) => [...p, { key: '', label: '', type: 'text', required: false }])} className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700">
                  <Plus size={12} /> Add custom field
                </button>
              )}
            </div>
          </div>

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />} {form ? 'Save changes' : 'Create form'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmbedModal({ form, onClose }: { form: LeadForm; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black text-slate-950">Share "{form.name}"</h2>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={15} /></button>
        </div>

        <p className="mt-4 text-xs font-bold text-slate-600">Hosted link</p>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{formUrl(form.id)}</code>
          <CopyButton text={formUrl(form.id)} label="Copy" />
        </div>

        <p className="mt-4 text-xs font-bold text-slate-600">Embed on your website</p>
        <div className="mt-1.5 flex items-start gap-2">
          <code className="flex-1 overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{embedSnippet(form.id)}</code>
          <CopyButton text={embedSnippet(form.id)} label="Copy" />
        </div>

        <a href={formUrl(form.id)} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 hover:text-indigo-700">
          <ExternalLink size={13} /> Preview form
        </a>
      </div>
    </div>
  );
}

export default function MarketingForms() {
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LeadForm | null | 'new'>(null);
  const [embedding, setEmbedding] = useState<LeadForm | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { forms: rows } = await api.get<{ forms: LeadForm[] }>('/api/forms');
      setForms(rows);
    } catch {
      setForms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleStatus = async (form: LeadForm) => {
    await api.put(`/api/forms/${form.id}`, { status: form.status === 'active' ? 'paused' : 'active' });
    void load();
  };

  const remove = async (form: LeadForm) => {
    if (!window.confirm(`Delete "${form.name}"? Embedded copies will show "Form not found".`)) return;
    await api.del(`/api/forms/${form.id}`);
    void load();
  };

  return (
    <div className="pb-10">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Forms</h1>
          <p className="mt-2 text-base text-slate-500">Capture leads from your website. Submissions land in Contacts and can start automations.</p>
        </div>
        <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">
          <Plus size={15} /> New form
        </button>
      </div>

      {loading && <div className="flex items-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> Loading forms…</div>}

      {!loading && forms.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <FileText size={28} className="mx-auto text-slate-300" />
          <p className="mt-3 text-sm font-bold text-slate-900">No forms yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">Create your first lead-capture form, then embed it on your site or share the hosted link.</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {forms.map((form) => (
          <div key={form.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-950">{form.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">{form.fields.length} field{form.fields.length === 1 ? '' : 's'} · created {new Date(form.created_at).toLocaleDateString()}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${form.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                {form.status}
              </span>
            </div>

            <p className="mt-4 text-3xl font-black text-slate-950">{form.submissions_count}</p>
            <p className="text-xs text-slate-400">submissions</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setEmbedding(form)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600">
                <Code size={12} /> Embed
              </button>
              <button type="button" onClick={() => setEditing(form)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600">
                Edit
              </button>
              <button type="button" onClick={() => void toggleStatus(form)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-slate-300">
                {form.status === 'active' ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Activate</>}
              </button>
              <button type="button" onClick={() => void remove(form)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50">
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing !== null && (
        <FormEditor
          form={editing === 'new' ? null : editing}
          onSaved={() => { setEditing(null); void load(); }}
          onClose={() => setEditing(null)}
        />
      )}
      {embedding && <EmbedModal form={embedding} onClose={() => setEmbedding(null)} />}
    </div>
  );
}
