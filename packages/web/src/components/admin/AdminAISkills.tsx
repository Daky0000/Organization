import { useEffect, useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, Pencil, Plus, Save, Trash2, X, Zap } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

const authHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const SCOPE_OPTIONS = [
  { value: 'all', label: 'All Pages', description: 'Active everywhere in the user dashboard' },
  { value: 'posts', label: 'Posts & Content', description: 'Active only on the Posts page' },
  { value: 'cards', label: 'Card Builder', description: 'Active only in the Card Builder' },
  { value: 'dashboard', label: 'Dashboard', description: 'Active only on the main dashboard' },
  { value: 'analytics', label: 'Analytics', description: 'Active only on the Analytics page' },
];

type Skill = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  scope: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type FormState = {
  name: string;
  description: string;
  system_prompt: string;
  scope: string;
  enabled: boolean;
};

const emptyForm = (): FormState => ({
  name: '',
  description: '',
  system_prompt: '',
  scope: 'all',
  enabled: true,
});

function ScopeBadge({ scope }: { scope: string }) {
  const opt = SCOPE_OPTIONS.find((o) => o.value === scope);
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
      {opt?.label ?? scope}
    </span>
  );
}

export default function AdminAISkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Expanded prompt view
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchSkills = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/ai-skills`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load skills');
      setSkills(data.skills ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchSkills(); }, []);

  const openCreate = () => {
    setCreating(true);
    setEditingId(null);
    setForm(emptyForm());
    setSaveError(null);
    setSaved(false);
  };

  const openEdit = (skill: Skill) => {
    setCreating(false);
    setEditingId(skill.id);
    setForm({
      name: skill.name,
      description: skill.description,
      system_prompt: skill.system_prompt,
      scope: skill.scope,
      enabled: skill.enabled,
    });
    setSaveError(null);
    setSaved(false);
  };

  const closeForm = () => {
    setCreating(false);
    setEditingId(null);
    setSaveError(null);
  };

  const saveForm = async () => {
    setSaveError(null);
    setSaved(false);
    if (!form.name.trim()) { setSaveError('Name is required'); return; }
    if (!form.system_prompt.trim()) { setSaveError('System prompt is required'); return; }
    setSaving(true);
    try {
      const isEdit = editingId !== null;
      const url = isEdit
        ? `${API_BASE_URL}/api/admin/ai-skills/${editingId}`
        : `${API_BASE_URL}/api/admin/ai-skills`;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await fetchSkills();
      if (!isEdit) closeForm();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (skill: Skill) => {
    try {
      await fetch(`${API_BASE_URL}/api/admin/ai-skills/${skill.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled: !skill.enabled }),
      });
      setSkills((prev) => prev.map((s) => s.id === skill.id ? { ...s, enabled: !s.enabled } : s));
    } catch { /* silent */ }
  };

  const deleteSkill = async (skill: Skill) => {
    if (!window.confirm(`Delete "${skill.name}"? This cannot be undone.`)) return;
    try {
      await fetch(`${API_BASE_URL}/api/admin/ai-skills/${skill.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setSkills((prev) => prev.filter((s) => s.id !== skill.id));
      if (editingId === skill.id) closeForm();
    } catch { /* silent */ }
  };

  const formPanel = (creating || editingId !== null) && (
    <div className="rounded-2xl border border-purple-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">
          {creating ? 'Create New Skill' : `Edit "${skills.find(s => s.id === editingId)?.name ?? ''}"`}
        </h3>
        <button type="button" onClick={closeForm} className="text-slate-400 hover:text-slate-700">
          <X size={18} />
        </button>
      </div>

      {/* Name */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">Skill Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Content Generator"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">Description <span className="font-normal text-slate-400">(optional)</span></label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Short description of what this skill does"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400"
        />
      </div>

      {/* Scope */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">Scope — where is this skill active?</label>
        <div className="grid gap-2">
          {SCOPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                form.scope === opt.value ? 'border-purple-400 bg-purple-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="skill-scope"
                value={opt.value}
                checked={form.scope === opt.value}
                onChange={() => setForm((f) => ({ ...f, scope: opt.value }))}
                className="accent-purple-500"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-slate-900">{opt.label}</span>
                <span className="ml-2 text-xs text-slate-500">{opt.description}</span>
              </div>
              {form.scope === opt.value && <Check size={14} className="shrink-0 text-purple-500" />}
            </label>
          ))}
        </div>
      </div>

      {/* System Prompt */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-slate-600">System Prompt</label>
        <textarea
          value={form.system_prompt}
          onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
          rows={16}
          placeholder="Describe what this skill does and how the AI should behave when it's active…"
          className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 font-mono leading-relaxed"
        />
        <p className="mt-1 text-xs text-slate-400">
          This prompt is appended to Daky's base prompt when the skill scope matches the user's current page.
        </p>
      </div>

      {/* Enabled */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form.enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
        >
          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${form.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
        <span className="text-sm text-slate-700">{form.enabled ? 'Enabled — active for users' : 'Disabled — not active'}</span>
      </div>

      {saveError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{saveError}</p>}

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={saveForm}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : <Save size={15} />}
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Skill'}
        </button>
        <button type="button" onClick={closeForm} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-cyan-400">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">AI Skills</h2>
            <p className="text-sm text-slate-500">
              Extend Daky's capabilities with custom skills — each adds new behaviour to the chat bot.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
        >
          <Plus size={16} />
          Create Skill
        </button>
      </div>

      {/* Create / Edit form */}
      {formPanel}

      {/* Skill list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-600">{error}</div>
      ) : skills.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
          <Bot className="mx-auto h-8 w-8 text-slate-300 mb-3" />
          <p className="text-sm font-semibold text-slate-500">No skills yet</p>
          <p className="mt-1 text-xs text-slate-400">Create a skill to extend Daky's capabilities.</p>
          <button type="button" onClick={openCreate} className="mt-4 flex items-center gap-2 mx-auto rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            <Plus size={15} /> Create Skill
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className={`rounded-2xl border bg-white transition-all ${editingId === skill.id ? 'border-purple-300 ring-1 ring-purple-200' : 'border-slate-200'}`}
            >
              <div className="flex items-start gap-4 p-5">
                {/* Enable toggle */}
                <button
                  type="button"
                  onClick={() => toggleEnabled(skill)}
                  className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${skill.enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
                  title={skill.enabled ? 'Disable skill' : 'Enable skill'}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${skill.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">{skill.name}</span>
                    <ScopeBadge scope={skill.scope} />
                    {!skill.enabled && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">Disabled</span>
                    )}
                    {skill.id === 'skill-content-generator-v1' && (
                      <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-600">Built-in</span>
                    )}
                  </div>
                  {skill.description && (
                    <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{skill.description}</p>
                  )}

                  {/* Expandable prompt preview */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === skill.id ? null : skill.id)}
                    className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                  >
                    <ChevronDown size={13} className={`transition-transform ${expandedId === skill.id ? 'rotate-180' : ''}`} />
                    {expandedId === skill.id ? 'Hide prompt' : 'Preview prompt'}
                  </button>

                  {expandedId === skill.id && (
                    <pre className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap border border-slate-100">
                      {skill.system_prompt}
                    </pre>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => editingId === skill.id ? closeForm() : openEdit(skill)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    title="Edit"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSkill(skill)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 space-y-1.5">
        <p className="font-semibold text-slate-800">How skills work</p>
        <ul className="list-disc list-inside space-y-1 text-slate-500">
          <li>Each skill's system prompt is appended to Daky's base prompt when the scope matches the user's page</li>
          <li>Skills with scope "All Pages" are always active in the chat widget</li>
          <li>Multiple skills can be active at the same time — Daky uses whichever is relevant to the user's request</li>
          <li>Disable a skill to remove it from Daky without deleting it</li>
          <li>Skill changes take effect immediately — no restart required</li>
        </ul>
      </div>
    </div>
  );
}
