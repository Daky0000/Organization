import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, DollarSign, TrendingUp, Target, Award, MoreHorizontal, X, Edit2, Trash2, Calendar, User, Building2, ChevronDown, BarChart3, Check, Pencil } from 'lucide-react';

const API = '/api/crm';
const tok = () => localStorage.getItem('auth_token') ?? '';
const authHeaders = () => ({ Authorization: `Bearer ${tok()}` });
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` });

interface Pipeline {
  id: string;
  name: string;
  stage_count: number;
  deal_count: number;
}

interface Stage {
  id: string;
  name: string;
  color: string;
  position: number;
  pipeline_id: string;
  deal_count: number;
  total_value: number;
}

interface Deal {
  id: string;
  title: string;
  value: number;
  currency: string;
  stage_id: string | null;
  stage_name: string | null;
  stage_color: string | null;
  contact_id: string | null;
  contact_email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  company_id: string | null;
  company_name: string | null;
  close_date: string | null;
  priority: string;
  status: string;
  probability: number;
  description: string | null;
  close_reason: string | null;
  position: number;
  created_at: string;
}

interface Stats {
  open_count: number;
  won_count: number;
  lost_count: number;
  open_value: number;
  won_value: number;
  avg_deal_size: number;
  forecast_value: number;
}

const PRIORITY_COLORS: Record<string, string> = { low: 'bg-gray-100 text-gray-500', medium: 'bg-amber-50 text-amber-600', high: 'bg-red-50 text-red-500' };
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };

function formatCurrency(value: number, currency = 'USD') {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

function DealCard({ deal, onClick, onDelete }: { deal: Deal; onClick: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div
      draggable
      onDragStart={e => e.dataTransfer.setData('dealId', deal.id)}
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-100 p-4 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 leading-snug flex-1">{deal.title}</p>
        <div ref={menuRef} className="relative flex-shrink-0">
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-600 rounded transition-all"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-6 bg-white border border-gray-100 rounded-xl shadow-lg py-1 w-36 z-20">
              <button onClick={e => { e.stopPropagation(); setMenuOpen(false); onClick(); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
              <button onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-500 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-base font-semibold text-gray-900">{formatCurrency(deal.value, deal.currency)}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[deal.priority]}`}>{PRIORITY_LABELS[deal.priority]}</span>
      </div>

      <div className="mt-3 space-y-1.5">
        {(deal.contact_first_name || deal.contact_email) && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <User className="w-3 h-3" />
            <span>{[deal.contact_first_name, deal.contact_last_name].filter(Boolean).join(' ') || deal.contact_email}</span>
          </div>
        )}
        {deal.company_name && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Building2 className="w-3 h-3" />
            <span>{deal.company_name}</span>
          </div>
        )}
        {deal.close_date && (
          <div className={`flex items-center gap-1.5 text-xs ${new Date(deal.close_date) < new Date() ? 'text-red-400' : 'text-gray-400'}`}>
            <Calendar className="w-3 h-3" />
            <span>{new Date(deal.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
        )}
      </div>

      {deal.probability > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>Probability</span><span>{deal.probability}%</span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${deal.probability}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pipeline switcher + management ───────────────────────────────────────────
function PipelineSwitcher({
  pipelines,
  selectedId,
  onSelect,
  onCreatePipeline,
  onRenamePipeline,
  onDeletePipeline,
}: {
  pipelines: Pipeline[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreatePipeline: () => void;
  onRenamePipeline: (p: Pipeline) => void;
  onDeletePipeline: (p: Pipeline) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = pipelines.find(p => p.id === selectedId);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors bg-white"
      >
        <BarChart3 className="w-4 h-4 text-gray-400" />
        <span className="max-w-[140px] truncate">{selected?.name ?? 'Select pipeline'}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 bg-white border border-gray-100 rounded-xl shadow-lg py-1 w-64 z-30">
          <p className="px-3 pt-1 pb-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Pipelines</p>
          {pipelines.map(p => (
            <div key={p.id} className="flex items-center group">
              <button
                onClick={() => { onSelect(p.id); setOpen(false); }}
                className={`flex-1 flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${p.id === selectedId ? 'text-[#2563EB] font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                {p.id === selectedId && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                {p.id !== selectedId && <span className="w-3.5" />}
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-xs text-gray-300 ml-auto">{p.deal_count} deals</span>
              </button>
              <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={e => { e.stopPropagation(); setOpen(false); onRenamePipeline(p); }}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded"
                  title="Rename"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                {pipelines.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); setOpen(false); onDeletePipeline(p); }}
                    className="p-1 text-gray-400 hover:text-red-500 rounded"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="border-t border-gray-50 mt-1 pt-1">
            <button
              onClick={() => { setOpen(false); onCreatePipeline(); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[#2563EB] hover:bg-indigo-50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New Pipeline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Win/Loss reason modal ─────────────────────────────────────────────────────
function CloseReasonModal({
  status,
  onConfirm,
  onCancel,
}: {
  status: 'won' | 'lost';
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const isWon = status === 'won';

  const WON_PRESETS = ['Great fit', 'Competitive price', 'Strong relationship', 'Superior product', 'Fast delivery'];
  const LOST_PRESETS = ['Too expensive', 'Chose competitor', 'Budget cut', 'No decision', 'Lost contact'];
  const presets = isWon ? WON_PRESETS : LOST_PRESETS;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className={`text-base font-semibold ${isWon ? 'text-emerald-600' : 'text-red-500'}`}>
            {isWon ? '🎉 Mark as Won' : '❌ Mark as Lost'}
          </h2>
          <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-500">Add a reason (optional) to help track patterns.</p>
          <div className="flex flex-wrap gap-1.5">
            {presets.map(p => (
              <button
                key={p}
                onClick={() => setReason(p)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${reason === p ? (isWon ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-red-50 border-red-300 text-red-600') : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
            placeholder="Or type a custom reason..."
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onCancel} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
          <button
            onClick={() => onConfirm(reason)}
            className={`flex-1 py-2 text-sm font-medium text-white rounded-lg transition-colors ${isWon ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'}`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CRMPipeline() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [showDealForm, setShowDealForm] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ title: '', value: '', currency: 'USD', stage_id: '', contact_id: '', company_id: '', close_date: '', priority: 'medium', probability: '0', description: '' });
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  // Pipeline management
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [pipelineModalMode, setPipelineModalMode] = useState<'create' | 'rename'>('create');
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);
  const [pipelineName, setPipelineName] = useState('');
  const [pipelineError, setPipelineError] = useState('');
  const [savingPipeline, setSavingPipeline] = useState(false);

  // Win/loss reason
  const [closeReasonTarget, setCloseReasonTarget] = useState<{ id: string; status: 'won' | 'lost' } | null>(null);

  const loadPipelines = useCallback(async () => {
    const r = await fetch(`${API}/pipelines`, { headers: authHeaders() });
    if (r.ok) {
      const rows: Pipeline[] = await r.json();
      setPipelines(rows);
      if (rows.length && !selectedPipelineId) setSelectedPipelineId(rows[0].id);
      return rows;
    }
    return [] as Pipeline[];
  }, [selectedPipelineId]);

  const loadForPipeline = useCallback(async (pipelineId: string) => {
    try {
      const [stagesRes, dealsRes, statsRes] = await Promise.all([
        fetch(`${API}/pipeline/stages?pipeline_id=${pipelineId}`, { headers: authHeaders() }),
        fetch(`${API}/deals?limit=500&pipeline_id=${pipelineId}`, { headers: authHeaders() }),
        fetch(`${API}/pipeline/stats?pipeline_id=${pipelineId}`, { headers: authHeaders() }),
      ]);
      if (stagesRes.ok) setStages(await stagesRes.json());
      if (dealsRes.ok) setDeals(await dealsRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch {
      // ignore
    }
  }, []);

  const loadAll = useCallback(async () => {
    const rows = await loadPipelines();
    const pid = selectedPipelineId || rows[0]?.id;
    if (pid) await loadForPipeline(pid);
  }, [loadPipelines, loadForPipeline, selectedPipelineId]);

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (selectedPipelineId) loadForPipeline(selectedPipelineId);
  }, [selectedPipelineId]);

  const openNewDeal = (stageId?: string) => {
    setEditingDeal(null);
    setForm({ title: '', value: '', currency: 'USD', stage_id: stageId || stages[0]?.id || '', contact_id: '', company_id: '', close_date: '', priority: 'medium', probability: '0', description: '' });
    setFormError('');
    setShowDealForm(true);
  };

  const openEditDeal = (deal: Deal) => {
    setEditingDeal(deal);
    setForm({
      title: deal.title,
      value: String(deal.value),
      currency: deal.currency,
      stage_id: deal.stage_id || '',
      contact_id: deal.contact_id || '',
      company_id: deal.company_id || '',
      close_date: deal.close_date ? deal.close_date.split('T')[0] : '',
      priority: deal.priority,
      probability: String(deal.probability),
      description: deal.description || '',
    });
    setFormError('');
    setShowDealForm(true);
    setSelectedDeal(null);
  };

  const saveDeal = async () => {
    if (!form.title.trim()) { setFormError('Title is required'); return; }
    setSaving(true); setFormError('');
    try {
      const payload = {
        title: form.title.trim(),
        value: parseFloat(form.value) || 0,
        currency: form.currency,
        stage_id: form.stage_id || null,
        contact_id: form.contact_id || null,
        company_id: form.company_id || null,
        close_date: form.close_date || null,
        priority: form.priority,
        probability: parseInt(form.probability) || 0,
        description: form.description || null,
      };
      const url = editingDeal ? `${API}/deals/${editingDeal.id}` : `${API}/deals`;
      const method = editingDeal ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: jsonHeaders(), body: JSON.stringify(payload) });
      if (!r.ok) { setFormError((await r.json()).error || 'Save failed'); return; }
      setShowDealForm(false);
      if (selectedPipelineId) loadForPipeline(selectedPipelineId);
    } finally {
      setSaving(false);
    }
  };

  const deleteDeal = async (id: string) => {
    if (!confirm('Delete this deal?')) return;
    await fetch(`${API}/deals/${id}`, { method: 'DELETE', headers: authHeaders() });
    setSelectedDeal(null);
    if (selectedPipelineId) loadForPipeline(selectedPipelineId);
  };

  const promptCloseReason = (id: string, status: 'won' | 'lost') => {
    setCloseReasonTarget({ id, status });
  };

  const confirmCloseReason = async (reason: string) => {
    if (!closeReasonTarget) return;
    const { id, status } = closeReasonTarget;
    setCloseReasonTarget(null);
    await fetch(`${API}/deals/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ status, close_reason: reason || null }),
    });
    setSelectedDeal(d => d ? { ...d, status, close_reason: reason || null } : null);
    if (selectedPipelineId) loadForPipeline(selectedPipelineId);
  };

  const reopenDeal = async (id: string) => {
    await fetch(`${API}/deals/${id}`, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ status: 'open', close_reason: null }) });
    setSelectedDeal(d => d ? { ...d, status: 'open', close_reason: null } : null);
    if (selectedPipelineId) loadForPipeline(selectedPipelineId);
  };

  const handleDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStage(null);
    const dealId = e.dataTransfer.getData('dealId');
    if (!dealId) return;
    await fetch(`${API}/deals/reorder`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ deal_id: dealId, stage_id: stageId }) });
    if (selectedPipelineId) loadForPipeline(selectedPipelineId);
  };

  // ── Pipeline management ────────────────────────────────────────────────────
  const openCreatePipeline = () => {
    setPipelineModalMode('create');
    setPipelineName('');
    setPipelineError('');
    setEditingPipeline(null);
    setShowPipelineModal(true);
  };

  const openRenamePipeline = (p: Pipeline) => {
    setPipelineModalMode('rename');
    setPipelineName(p.name);
    setPipelineError('');
    setEditingPipeline(p);
    setShowPipelineModal(true);
  };

  const savePipeline = async () => {
    if (!pipelineName.trim()) { setPipelineError('Name is required'); return; }
    setSavingPipeline(true); setPipelineError('');
    try {
      let r: Response;
      if (pipelineModalMode === 'create') {
        r = await fetch(`${API}/pipelines`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ name: pipelineName.trim() }) });
      } else {
        r = await fetch(`${API}/pipelines/${editingPipeline!.id}`, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ name: pipelineName.trim() }) });
      }
      if (!r.ok) { setPipelineError((await r.json()).error || 'Save failed'); return; }
      const saved = await r.json();
      setShowPipelineModal(false);
      if (pipelineModalMode === 'create') {
        setSelectedPipelineId(saved.id);
      }
      await loadPipelines();
      if (pipelineModalMode === 'create') await loadForPipeline(saved.id);
    } finally {
      setSavingPipeline(false);
    }
  };

  const deletePipeline = async (p: Pipeline) => {
    if (!confirm(`Delete pipeline "${p.name}"? All its stages will lose their association with this pipeline.`)) return;
    const r = await fetch(`${API}/pipelines/${p.id}`, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) {
      const err = await r.json();
      alert(err.error || 'Could not delete pipeline');
      return;
    }
    const remaining = pipelines.filter(x => x.id !== p.id);
    if (remaining.length) {
      setSelectedPipelineId(remaining[0].id);
    }
    await loadPipelines();
  };

  const filteredDeals = deals.filter(d => !search || d.title.toLowerCase().includes(search.toLowerCase()) || d.company_name?.toLowerCase().includes(search.toLowerCase()));
  const dealsByStage = (stageId: string) => filteredDeals.filter(d => d.stage_id === stageId && d.status === 'open');

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-5">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Deals</h1>
              <p className="text-sm text-gray-500 mt-0.5">Track deals and revenue opportunities</p>
            </div>
            {pipelines.length > 0 && (
              <PipelineSwitcher
                pipelines={pipelines}
                selectedId={selectedPipelineId}
                onSelect={setSelectedPipelineId}
                onCreatePipeline={openCreatePipeline}
                onRenamePipeline={openRenamePipeline}
                onDeletePipeline={deletePipeline}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] w-52" placeholder="Search deals..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {(['board', 'list'] as const).map(v => (
                <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{v}</button>
              ))}
            </div>
            <button onClick={() => openNewDeal()} className="flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#4a5be8] transition-colors">
              <Plus className="w-4 h-4" /> New Deal
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-5 gap-4">
            {[
              { icon: TrendingUp, label: 'Open Deals', value: stats.open_count, sub: formatCurrency(stats.open_value), color: 'text-[#2563EB] bg-indigo-50' },
              { icon: Award, label: 'Won', value: stats.won_count, sub: formatCurrency(stats.won_value), color: 'text-emerald-600 bg-emerald-50' },
              { icon: Target, label: 'Lost', value: stats.lost_count, sub: '', color: 'text-red-500 bg-red-50' },
              { icon: DollarSign, label: 'Avg Deal Size', value: formatCurrency(stats.avg_deal_size), sub: 'on won deals', color: 'text-amber-600 bg-amber-50' },
              { icon: BarChart3, label: 'Forecast', value: formatCurrency(stats.forecast_value), sub: 'weighted pipeline', color: 'text-violet-600 bg-violet-50' },
            ].map(({ icon: Icon, label, value, sub, color }) => (
              <div key={label} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center flex-shrink-0`}><Icon className="w-4 h-4" /></div>
                <div>
                  <p className="text-lg font-semibold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-400">{label}{sub ? ` · ${sub}` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Board view */}
      {view === 'board' && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-4 p-6 h-full min-h-0" style={{ minWidth: `${stages.length * 280 + 48}px` }}>
            {stages.map(stage => (
              <div
                key={stage.id}
                className={`flex flex-col w-64 flex-shrink-0 rounded-xl transition-colors ${dragOverStage === stage.id ? 'bg-indigo-50 ring-2 ring-[#2563EB]/30' : 'bg-gray-100'}`}
                onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id); }}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={e => handleDrop(e, stage.id)}
              >
                <div className="flex items-center gap-2.5 px-4 py-3">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                  <span className="font-semibold text-sm text-gray-800 flex-1">{stage.name}</span>
                  <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded-full">{dealsByStage(stage.id).length}</span>
                </div>
                {stage.total_value > 0 && (
                  <div className="px-4 pb-2">
                    <span className="text-xs font-medium text-gray-500">{formatCurrency(stage.total_value)}</span>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2 min-h-0">
                  {dealsByStage(stage.id).map(deal => (
                    <DealCard key={deal.id} deal={deal} onClick={() => setSelectedDeal(deal)} onDelete={() => deleteDeal(deal.id)} />
                  ))}
                </div>
                <button
                  onClick={() => openNewDeal(stage.id)}
                  className="flex items-center gap-2 mx-3 mb-3 px-3 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add deal
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Deal', 'Stage', 'Value', 'Priority', 'Contact', 'Company', 'Close Date', 'Status'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredDeals.map(deal => (
                  <tr key={deal.id} onClick={() => setSelectedDeal(deal)} className="hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{deal.title}</td>
                    <td className="px-4 py-3">
                      {deal.stage_name
                        ? <span className="flex items-center gap-1.5 text-sm text-gray-600"><span className="w-2 h-2 rounded-full" style={{ background: deal.stage_color || '#ccc' }} />{deal.stage_name}</span>
                        : <span className="text-sm text-gray-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(deal.value, deal.currency)}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[deal.priority]}`}>{PRIORITY_LABELS[deal.priority]}</span></td>
                    <td className="px-4 py-3 text-sm text-gray-500">{[deal.contact_first_name, deal.contact_last_name].filter(Boolean).join(' ') || deal.contact_email || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{deal.company_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{deal.close_date ? new Date(deal.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${deal.status === 'won' ? 'bg-emerald-50 text-emerald-600' : deal.status === 'lost' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>{deal.status}</span>
                    </td>
                  </tr>
                ))}
                {filteredDeals.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-gray-400 text-sm">No deals found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Deal detail slide-over */}
      {selectedDeal && (
        <div className="fixed inset-0 bg-black/30 flex justify-end z-40" onClick={() => setSelectedDeal(null)}>
          <div className="w-[480px] bg-white h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900 truncate pr-4">{selectedDeal.title}</h2>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => openEditDeal(selectedDeal)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><Edit2 className="w-4 h-4" /></button>
                <button onClick={() => deleteDeal(selectedDeal.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                <button onClick={() => setSelectedDeal(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-1">Deal Value</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(selectedDeal.value, selectedDeal.currency)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-1">Stage</p>
                  <div className="flex items-center gap-2 mt-1">
                    {selectedDeal.stage_color && <div className="w-2.5 h-2.5 rounded-full" style={{ background: selectedDeal.stage_color }} />}
                    <p className="text-sm font-medium text-gray-800">{selectedDeal.stage_name || 'Unassigned'}</p>
                  </div>
                </div>
              </div>

              {/* Status + close reason */}
              {selectedDeal.status !== 'open' && selectedDeal.close_reason && (
                <div className={`flex items-start gap-2 px-4 py-3 rounded-xl text-sm ${selectedDeal.status === 'won' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  <span className="font-medium">{selectedDeal.status === 'won' ? 'Won reason:' : 'Lost reason:'}</span>
                  <span>{selectedDeal.close_reason}</span>
                </div>
              )}

              {selectedDeal.status === 'open' && (
                <div className="flex gap-3">
                  <button onClick={() => promptCloseReason(selectedDeal.id, 'won')} className="flex-1 py-2 bg-emerald-50 text-emerald-600 text-sm font-medium rounded-lg hover:bg-emerald-100 transition-colors">Mark Won</button>
                  <button onClick={() => promptCloseReason(selectedDeal.id, 'lost')} className="flex-1 py-2 bg-red-50 text-red-500 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors">Mark Lost</button>
                </div>
              )}
              {selectedDeal.status !== 'open' && (
                <button onClick={() => reopenDeal(selectedDeal.id)} className="w-full py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">Reopen Deal</button>
              )}

              <div className="bg-white border border-gray-100 rounded-xl divide-y divide-gray-50">
                {[
                  { label: 'Status', value: <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${selectedDeal.status === 'won' ? 'bg-emerald-50 text-emerald-600' : selectedDeal.status === 'lost' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>{selectedDeal.status}</span> },
                  { label: 'Priority', value: <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_COLORS[selectedDeal.priority]}`}>{PRIORITY_LABELS[selectedDeal.priority]}</span> },
                  { label: 'Probability', value: `${selectedDeal.probability}%` },
                  { label: 'Close Date', value: selectedDeal.close_date ? new Date(selectedDeal.close_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—' },
                  { label: 'Contact', value: [selectedDeal.contact_first_name, selectedDeal.contact_last_name].filter(Boolean).join(' ') || selectedDeal.contact_email || '—' },
                  { label: 'Company', value: selectedDeal.company_name || '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-500">{label}</span>
                    <span className="text-sm text-gray-900 font-medium">{value}</span>
                  </div>
                ))}
              </div>

              {selectedDeal.description && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Description</p>
                  <p className="text-sm text-gray-600 leading-relaxed">{selectedDeal.description}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Deal form modal */}
      {showDealForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">{editingDeal ? 'Edit Deal' : 'New Deal'}</h2>
              <button onClick={() => setShowDealForm(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {formError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Deal Title *</label>
                <input className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Website Redesign Project" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Value</label>
                  <input type="number" min="0" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Currency</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] bg-white" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                    {['USD','EUR','GBP','GHS','NGN','KES','ZAR'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Pipeline Stage</label>
                <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] bg-white" value={form.stage_id} onChange={e => setForm(f => ({ ...f, stage_id: e.target.value }))}>
                  <option value="">No stage</option>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Priority</label>
                  <select className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] bg-white" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Probability (%)</label>
                  <input type="number" min="0" max="100" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.probability} onChange={e => setForm(f => ({ ...f, probability: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Expected Close Date</label>
                <input type="date" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]" value={form.close_date} onChange={e => setForm(f => ({ ...f, close_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
                <textarea className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] resize-none" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Notes about this deal..." />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setShowDealForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveDeal} disabled={saving} className="px-5 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#4a5be8] disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : editingDeal ? 'Update Deal' : 'Create Deal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline create/rename modal */}
      {showPipelineModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">{pipelineModalMode === 'create' ? 'New Pipeline' : 'Rename Pipeline'}</h2>
              <button onClick={() => setShowPipelineModal(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              {pipelineError && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{pipelineError}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Pipeline name</label>
                <input
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  placeholder="e.g. Enterprise Sales"
                  value={pipelineName}
                  onChange={e => setPipelineName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') savePipeline(); }}
                />
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowPipelineModal(false)} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={savePipeline} disabled={savingPipeline} className="flex-1 py-2 text-sm font-medium text-white bg-[#2563EB] rounded-lg hover:bg-[#4a5be8] disabled:opacity-50 transition-colors">
                {savingPipeline ? 'Saving...' : pipelineModalMode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Win/Loss reason modal */}
      {closeReasonTarget && (
        <CloseReasonModal
          status={closeReasonTarget.status}
          onConfirm={confirmCloseReason}
          onCancel={() => setCloseReasonTarget(null)}
        />
      )}
    </div>
  );
}
