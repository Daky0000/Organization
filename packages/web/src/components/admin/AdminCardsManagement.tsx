import { useEffect, useRef, useState } from 'react';
import { Plus, Edit2, Trash2, Upload, FileUp } from 'lucide-react';
import {
  AdminCardTemplate,
  FabricDesignData,
  isFabricDesign,
} from '../../types/cardTemplate';
import { cardTemplateService } from '../../services/cardTemplateService';
import AdminFabricBuilder from './AdminFabricBuilder';

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
        checked ? 'bg-green-500' : 'bg-slate-200'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ── JSON import modal ─────────────────────────────────────────────────────────
function JsonImportModal({ onImport, onClose }: {
  onImport: (items: Array<{ name: string; description: string; designData: FabricDesignData }>) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseAndImport = (text: string) => {
    setError(null);
    try {
      const parsed = JSON.parse(text) as unknown;
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const items = (arr as Record<string, unknown>[]).map((item, i) => {
        // Support both wrapped format { name, designData } and raw FabricDesignData
        if ((item as Record<string, unknown>).fabricVersion === true) {
          // Raw FabricDesignData — use a default name
          const dd = item as Record<string, unknown>;
          return {
            name: 'Imported Template',
            description: '',
            designData: dd as unknown as FabricDesignData,
          };
        }
        if (!item.name) throw new Error(`Item ${i + 1}: missing "name"`);
        if (!item.designData) throw new Error(`Item ${i + 1}: missing "designData"`);
        const dd = item.designData as Record<string, unknown>;
        if (dd.fabricVersion !== true) throw new Error(`Item ${i + 1}: "designData" must have fabricVersion: true`);
        return {
          name: String(item.name),
          description: String(item.description ?? ''),
          designData: dd as unknown as FabricDesignData,
        };
      });
      onImport(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const handleFileUpload = (file: File) => {
    if (!file.name.endsWith('.json')) { setError('Only .json files are supported'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRaw(text);
      parseAndImport(text);
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="border-b px-6 py-5">
          <h2 className="text-xl font-bold text-slate-900">Import Templates from JSON</h2>
          <p className="mt-1 text-sm text-slate-500">
            Upload a <code className="rounded bg-slate-100 px-1 text-xs">.json</code> file exported from the card builder, or paste JSON below.
          </p>
        </div>
        <div className="p-6 space-y-4">
          {/* File upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ''; }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-600 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
          >
            <FileUp size={16} /> Upload .json file
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-100" />
            <span className="text-xs text-slate-400">or paste JSON</span>
            <div className="h-px flex-1 bg-slate-100" />
          </div>

          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='[{ "name": "Template 1", "description": "", "designData": { "fabricVersion": true, ... } }]'
            rows={10}
            className="w-full rounded-xl border border-slate-300 p-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose}
              className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="button" onClick={() => parseAndImport(raw)}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition">
              Import Templates
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const AdminCardsManagement = () => {
  const [templates, setTemplates] = useState<AdminCardTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // New template form
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // Builder
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const [builderName, setBuilderName] = useState('');
  const [builderDescription, setBuilderDescription] = useState('');
  const [builderIsPublished, setBuilderIsPublished] = useState(false);
  const [builderCoverImageUrl, setBuilderCoverImageUrl] = useState<string | null>(null);
  const [builderExistingData, setBuilderExistingData] = useState<FabricDesignData | null>(null);

  // Per-card toggle saving state
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [, setIsSaving] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);

  const fetchTemplates = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      setTemplates(await cardTemplateService.getTemplates());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load card templates');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void fetchTemplates(); }, []);

  // ── Open builder ──────────────────────────────────────────────────────────
  const openBuilder = (
    id: string | null,
    name: string,
    description: string,
    isPublished: boolean,
    existingData: FabricDesignData | null,
    coverImageUrl?: string | null,
  ) => {
    editingIdRef.current = id;
    setEditingId(id);
    setBuilderName(name);
    setBuilderDescription(description);
    setBuilderIsPublished(isPublished);
    setBuilderCoverImageUrl(coverImageUrl ?? null);
    setBuilderExistingData(existingData);
    setIsBuilderOpen(true);
  };

  const handleStartBuilder = () => {
    if (!newName.trim()) { setErrorMessage('Please enter a template name'); return; }
    setErrorMessage(null);
    setIsFormOpen(false);
    openBuilder(null, newName.trim(), newDesc.trim(), false, null);
    setNewName('');
    setNewDesc('');
  };

  // ── Save Draft ────────────────────────────────────────────────────────────
  // Save draft is handled inside AdminFabricBuilder now.

  // ── Publish (builder already saved draft before calling this) ─────────────
  // Publish is handled inside AdminFabricBuilder now.

  // ── Unpublish (from builder button) ──────────────────────────────────────
  // Unpublish is handled inside AdminFabricBuilder now.

  // ── Toggle publish from card list ─────────────────────────────────────────
  const handleTogglePublish = async (template: AdminCardTemplate) => {
    try {
      setTogglingId(template.id);
      setErrorMessage(null);
      if (template.isPublished) {
        await cardTemplateService.unpublishTemplate(template.id);
        setSuccessMessage(`"${template.name}" unpublished`);
      } else {
        await cardTemplateService.publishTemplate(template.id, { coverImageUrl: template.coverImageUrl ?? '' });
        setSuccessMessage(`"${template.name}" published`);
      }
      await fetchTemplates();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update template');
    } finally {
      setTogglingId(null);
    }
  };

  const handleEdit = (template: AdminCardTemplate) => {
    const existing = isFabricDesign(template.designData) ? template.designData : null;
    openBuilder(template.id, template.name, template.description, template.isPublished, existing, template.coverImageUrl);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this card template? This cannot be undone.')) return;
    try {
      setErrorMessage(null);
      await cardTemplateService.deleteTemplate(id);
      setSuccessMessage('Template deleted');
      await fetchTemplates();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete template');
    }
  };

  // ── JSON bulk import ──────────────────────────────────────────────────────
  const handleJsonImport = async (items: Array<{ name: string; description: string; designData: FabricDesignData }>) => {
    setShowJsonImport(false);
    setIsSaving(true);
    setErrorMessage(null);
    let count = 0;
    for (const item of items) {
      try {
        await cardTemplateService.createTemplate({ name: item.name, description: item.description, designData: item.designData });
        count++;
      } catch { /* skip individual failures */ }
    }
    setSuccessMessage(`Imported ${count} template${count !== 1 ? 's' : ''}`);
    await fetchTemplates();
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-500" />
      </div>
    );
  }

  // Builder is open — full screen
  if (isBuilderOpen) {
    return (
      <AdminFabricBuilder
        templateId={editingId}
        templateName={builderName}
        templateDescription={builderDescription}
        isPublished={builderIsPublished}
        existingDesignData={builderExistingData}
        existingCoverImageUrl={builderCoverImageUrl ?? undefined}
        onTemplateUpdated={fetchTemplates}
        onClose={(refreshNeeded) => {
          setIsBuilderOpen(false);
          setBuilderExistingData(null);
          editingIdRef.current = null;
          setEditingId(null);
          if (refreshNeeded) void fetchTemplates();
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Card Templates</h1>
          <p className="mt-1 text-sm text-slate-500">Build and publish templates for the user dashboard.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowJsonImport(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <Upload size={16} />
            Import JSON
          </button>
          <button
            onClick={() => { setNewName(''); setNewDesc(''); setIsFormOpen(true); }}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition"
          >
            <Plus size={18} />
            New Template
          </button>
        </div>
      </div>

      {/* Alerts */}
      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</div>
      )}
      {successMessage && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">{successMessage}</div>
      )}

      {/* Templates grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {templates.map((template) => (
          <div key={template.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition">
            <div className="relative aspect-video bg-slate-100">
              {template.coverImageUrl ? (
                <img src={template.coverImageUrl} alt={template.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-slate-400">
                  <p className="text-sm">No preview</p>
                  {isFabricDesign(template.designData) && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-600">Fabric.js</span>
                  )}
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900 truncate">{template.name}</h3>
                  {template.description && (
                    <p className="mt-1 text-sm text-slate-500 line-clamp-2">{template.description}</p>
                  )}
                </div>
                {/* Publish toggle */}
                <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                  <Toggle
                    checked={template.isPublished}
                    onChange={() => void handleTogglePublish(template)}
                    disabled={togglingId === template.id}
                  />
                  <span className={`text-[10px] font-semibold ${template.isPublished ? 'text-green-600' : 'text-slate-400'}`}>
                    {togglingId === template.id ? '…' : template.isPublished ? 'Published' : 'Draft'}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {new Date(template.createdAt).toLocaleDateString()}
                {isFabricDesign(template.designData) && (
                  <span className="ml-2 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-500">Fabric</span>
                )}
              </p>
              <div className="mt-4 flex gap-2">
                <button onClick={() => handleEdit(template)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition">
                  <Edit2 size={14} />
                  Edit
                </button>
                <button onClick={() => void handleDelete(template.id)}
                  className="flex items-center justify-center rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-500 hover:bg-red-100 transition">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center">
          <p className="text-slate-500">No templates yet — create your first one!</p>
        </div>
      )}

      {/* New Template Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="border-b px-6 py-5">
              <h2 className="text-xl font-bold text-slate-900">New Card Template</h2>
              <p className="mt-1 text-sm text-slate-500">Name your template, then open the Fabric.js design editor.</p>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleStartBuilder(); }} className="space-y-5 p-6">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Template Name *</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Marketing Quote Card" autoFocus />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Description</label>
                <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Brief description shown in the gallery" rows={3} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setIsFormOpen(false)}
                  className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
                  Cancel
                </button>
                <button type="submit"
                  className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition">
                  Open Editor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* JSON Import Modal */}
      {showJsonImport && (
        <JsonImportModal
          onImport={(items) => void handleJsonImport(items)}
          onClose={() => setShowJsonImport(false)}
        />
      )}
    </div>
  );
};

export default AdminCardsManagement;
