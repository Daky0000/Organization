import { useState, useEffect, useCallback } from 'react';
import { Plus, Zap, X, Edit2, Trash2, ToggleLeft, ToggleRight, Info } from 'lucide-react';

const API = '/api/crm';
const tok = () => localStorage.getItem('auth_token') ?? '';
const authHeaders = () => ({ Authorization: `Bearer ${tok()}` });
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` });

interface ScoringRule {
  id: string;
  name: string;
  condition: { field: string; op: string; value: string };
  points: number;
  active: boolean;
  position: number;
}

const FIELD_OPTIONS = [
  { value: 'tag', label: 'Has tag' },
  { value: 'subscribed', label: 'Email subscription status' },
  { value: 'email_consent', label: 'Email marketing consent' },
];

const OP_OPTIONS: Record<string, { value: string; label: string }[]> = {
  tag: [{ value: 'has', label: 'has tag' }, { value: 'not_has', label: 'does not have tag' }],
  subscribed: [{ value: 'is_true', label: 'is subscribed' }, { value: 'is_false', label: 'is unsubscribed' }],
  email_consent: [{ value: 'is_true', label: 'has given consent' }, { value: 'is_false', label: 'has not given consent' }],
};

const NEEDS_VALUE = (field: string) => field === 'tag';

const POINT_PRESETS = [-20, -10, -5, 5, 10, 15, 20, 25, 30, 50];

function RuleRow({ rule, onToggle, onEdit, onDelete }: {
  rule: ScoringRule;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const fieldLabel = FIELD_OPTIONS.find(f => f.value === rule.condition.field)?.label || rule.condition.field;
  const opLabel = OP_OPTIONS[rule.condition.field]?.find(o => o.value === rule.condition.op)?.label || rule.condition.op;

  return (
    <div className={`flex items-center gap-4 px-5 py-4 border-b border-gray-50 last:border-0 ${!rule.active ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900">{rule.name}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {fieldLabel} {opLabel}{rule.condition.value ? ` "${rule.condition.value}"` : ''}
          </span>
        </div>
      </div>
      <div className={`flex-shrink-0 font-bold text-sm px-3 py-1 rounded-full ${rule.points >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
        {rule.points >= 0 ? `+${rule.points}` : rule.points} pts
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={onToggle} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors" title={rule.active ? 'Disable rule' : 'Enable rule'}>
          {rule.active ? <ToggleRight className="w-5 h-5 text-[#2563EB]" /> : <ToggleLeft className="w-5 h-5" />}
        </button>
        <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"><Edit2 className="w-4 h-4" /></button>
        <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

export default function CRMLeadScoring() {
  const [rules, setRules] = useState<ScoringRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<ScoringRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ name: '', field: 'tag', op: 'has', value: '', points: '10' });

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/scoring/rules`, { headers: authHeaders() });
      if (r.ok) setRules(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRules(); }, []);

  const openCreate = () => {
    setEditingRule(null);
    setForm({ name: '', field: 'tag', op: 'has', value: '', points: '10' });
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (rule: ScoringRule) => {
    setEditingRule(rule);
    setForm({ name: rule.name, field: rule.condition.field, op: rule.condition.op, value: rule.condition.value || '', points: String(rule.points) });
    setFormError('');
    setShowForm(true);
  };

  const handleFieldChange = (field: string) => {
    const defaultOp = OP_OPTIONS[field]?.[0]?.value || 'is_true';
    setForm(f => ({ ...f, field, op: defaultOp, value: '' }));
  };

  const saveRule = async () => {
    if (!form.name.trim()) { setFormError('Rule name is required'); return; }
    if (NEEDS_VALUE(form.field) && !form.value.trim()) { setFormError('Tag value is required'); return; }
    const pts = parseInt(form.points);
    if (isNaN(pts)) { setFormError('Points must be a number'); return; }
    setSaving(true); setFormError('');
    try {
      const payload = {
        name: form.name.trim(),
        condition: { field: form.field, op: form.op, value: NEEDS_VALUE(form.field) ? form.value.trim() : '' },
        points: pts,
      };
      const url = editingRule ? `${API}/scoring/rules/${editingRule.id}` : `${API}/scoring/rules`;
      const method = editingRule ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: jsonHeaders(), body: JSON.stringify(payload) });
      if (!r.ok) { setFormError((await r.json()).error || 'Save failed'); return; }
      setShowForm(false);
      loadRules();
    } finally { setSaving(false); }
  };

  const toggleRule = async (rule: ScoringRule) => {
    await fetch(`${API}/scoring/rules/${rule.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ active: !rule.active }),
    });
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: !r.active } : r));
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Delete this scoring rule?')) return;
    await fetch(`${API}/scoring/rules/${id}`, { method: 'DELETE', headers: authHeaders() });
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const totalActive = rules.filter(r => r.active).length;
  const maxPossible = rules.filter(r => r.active && r.points > 0).reduce((s, r) => s + r.points, 0);

  return (
    <div className="max-w-3xl mx-auto p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lead Scoring</h1>
          <p className="text-sm text-gray-500 mt-1">Define rules that automatically score your contacts based on their attributes and behavior.</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#4a5be8] transition-colors">
          <Plus className="w-4 h-4" /> Add Rule
        </button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-6">
        <Info className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-indigo-700">
          <strong>How it works:</strong> Each rule adds or subtracts points from a contact's lead score (0–100). Contacts with higher scores are more engaged.
          {maxPossible > 0 && <span className="ml-1">With your current rules, a contact can earn up to <strong>{Math.min(maxPossible, 100)} pts</strong>.</span>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Rules', value: rules.length },
          { label: 'Active Rules', value: totalActive },
          { label: 'Max Score', value: `${Math.min(maxPossible, 100)} pts` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-100 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Rules list */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading rules...</div>
        ) : rules.length === 0 ? (
          <div className="py-16 text-center">
            <Zap className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No scoring rules yet</p>
            <p className="text-gray-400 text-sm mt-1">Create your first rule to start scoring contacts automatically.</p>
            <button onClick={openCreate} className="mt-4 px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#4a5be8]">Add Rule</button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100">
              <span className="text-xs font-medium text-gray-500 flex-1">Rule</span>
              <span className="text-xs font-medium text-gray-500 w-16 text-center">Points</span>
              <span className="text-xs font-medium text-gray-500 w-24 text-right">Actions</span>
            </div>
            {rules.map(rule => (
              <RuleRow key={rule.id} rule={rule} onToggle={() => toggleRule(rule)} onEdit={() => openEdit(rule)} onDelete={() => deleteRule(rule.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Score tiers explanation */}
      <div className="mt-6 bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Score Tiers</h3>
        <div className="flex gap-4">
          {[
            { label: 'Hot', range: '70–100', color: 'bg-red-100 text-red-600' },
            { label: 'Warm', range: '30–69', color: 'bg-amber-100 text-amber-600' },
            { label: 'Cold', range: '0–29', color: 'bg-gray-100 text-gray-500' },
          ].map(({ label, range, color }) => (
            <div key={label} className={`flex-1 rounded-lg ${color} px-3 py-2.5 text-center`}>
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-xs mt-0.5 opacity-75">{range} pts</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">Scores are visible in the Contacts list and can be used as segment filters.</p>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">{editingRule ? 'Edit Rule' : 'New Scoring Rule'}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {formError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Rule Name *</label>
                <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder='e.g. "Has newsletter tag"' />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Condition</label>
                <div className="space-y-2">
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] bg-white"
                    value={form.field} onChange={e => handleFieldChange(e.target.value)}>
                    {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] bg-white"
                    value={form.op} onChange={e => setForm(f => ({ ...f, op: e.target.value }))}>
                    {(OP_OPTIONS[form.field] || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {NEEDS_VALUE(form.field) && (
                    <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                      value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="Tag name (e.g. newsletter)" />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Points (positive = add, negative = deduct)</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {POINT_PRESETS.map(p => (
                    <button key={p} type="button" onClick={() => setForm(f => ({ ...f, points: String(p) }))}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${form.points === String(p) ? 'bg-[#2563EB] text-white' : p < 0 ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                      {p > 0 ? `+${p}` : p}
                    </button>
                  ))}
                </div>
                <input type="number" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  value={form.points} onChange={e => setForm(f => ({ ...f, points: e.target.value }))} placeholder="e.g. 10" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveRule} disabled={saving} className="px-5 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#4a5be8] disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
