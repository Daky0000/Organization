import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Settings, Save, Trash2, Plus, RefreshCw,
  CheckCircle2, AlertCircle, Globe, Lock, ChevronDown, ChevronUp,
  ArrowRight, ArrowLeft as ArrowLeftIcon, Minus
} from 'lucide-react';

const API = '/api/connectors';
const tok = () => localStorage.getItem('auth_token') ?? '';
const authHeaders = () => ({ Authorization: `Bearer ${tok()}` });
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` });

interface Domain {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  position: number;
  provider_count: number;
  active_provider: Provider | null;
  active_provider_slug: string;
  providers: Provider[];
  connected_count: number;
}

interface Provider {
  slug: string;
  name: string;
  description: string;
  is_native: boolean;
  requires_integration_slug: string | null;
  capabilities: string[];
  position: number;
  user_has_access: boolean;
}

interface FieldMap {
  id: string;
  domain_slug: string;
  provider_slug: string;
  external_field: string;
  native_field: string;
  transform: string | null;
  direction: 'inbound' | 'outbound' | 'both';
}

interface DefaultMap {
  external: string;
  native: string;
}

const DIRECTION_LABELS: Record<string, string> = {
  inbound: 'External → Native',
  outbound: 'Native → External',
  both: 'Bidirectional',
};

function ProviderCard({
  provider,
  isActive,
  onActivate,
  onDeactivate,
  disabled,
}: {
  provider: Provider;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  disabled: boolean;
}) {
  return (
    <div className={`border rounded-xl p-4 transition-all ${
      isActive ? 'border-[#2563EB] bg-[#2563EB]/5' :
      provider.user_has_access ? 'border-gray-200 bg-white hover:border-gray-300' :
      'border-dashed border-gray-200 bg-gray-50'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-gray-900">{provider.name}</span>
            {provider.is_native && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Native</span>
            )}
            {isActive && (
              <span className="text-xs bg-[#2563EB]/10 text-[#2563EB] px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Active
              </span>
            )}
            {!provider.user_has_access && (
              <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <Lock className="w-3 h-3" /> Not connected
              </span>
            )}
          </div>
          {provider.description && (
            <p className="text-xs text-gray-400 mb-2">{provider.description}</p>
          )}
          {provider.capabilities?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {provider.capabilities.slice(0, 5).map(cap => (
                <span key={cap} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                  {cap.replace(/_/g, ' ')}
                </span>
              ))}
              {provider.capabilities.length > 5 && (
                <span className="text-xs text-gray-400">+{provider.capabilities.length - 5} more</span>
              )}
            </div>
          )}
        </div>
        <div className="ml-3 flex-shrink-0">
          {isActive ? (
            provider.is_native ? null : (
              <button
                onClick={onDeactivate}
                disabled={disabled}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1 rounded border border-gray-200 hover:border-red-200"
              >
                Reset to native
              </button>
            )
          ) : (
            <button
              onClick={onActivate}
              disabled={disabled || !provider.user_has_access}
              title={!provider.user_has_access ? `Connect ${provider.name} from Integrations first` : undefined}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${
                provider.user_has_access
                  ? 'bg-[#2563EB] text-white hover:bg-[#4a5be8]'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {provider.user_has_access ? 'Activate' : 'Connect first'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldMapRow({
  map,
  onDelete,
}: {
  map: FieldMap;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 rounded-lg group">
      <span className="text-xs font-mono text-gray-600 flex-1 min-w-0 truncate">{map.external_field}</span>
      {map.direction === 'inbound' ? (
        <ArrowRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      ) : map.direction === 'outbound' ? (
        <ArrowLeftIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      ) : (
        <Minus className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      )}
      <span className="text-xs font-mono text-[#2563EB] flex-1 min-w-0 truncate">{map.native_field}</span>
      <span className="text-xs text-gray-400 w-24 text-right flex-shrink-0">{DIRECTION_LABELS[map.direction]}</span>
      {map.transform && (
        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex-shrink-0">{map.transform}</span>
      )}
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all ml-1 flex-shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default function ConnectorProviderSetup({
  domain,
  onBack,
}: {
  domain: Domain;
  onBack: () => void;
}) {
  const [providers] = useState<Provider[]>(domain.providers || []);
  const [activeSlug, setActiveSlug] = useState(domain.active_provider_slug || 'native');
  const [switching, setSwitching] = useState(false);
  const [fieldMaps, setFieldMaps] = useState<FieldMap[]>([]);
  const [defaults, setDefaults] = useState<DefaultMap[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(false);
  const [showAddMap, setShowAddMap] = useState(false);
  const [showDefaultsSuggestion, setShowDefaultsSuggestion] = useState(false);
  const [savingMap, setSavingMap] = useState(false);
  const [mapForm, setMapForm] = useState({
    external_field: '',
    native_field: '',
    direction: 'inbound' as 'inbound' | 'outbound' | 'both',
    transform: '',
  });
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(true);

  const activeProvider = providers.find(p => p.slug === activeSlug) || providers.find(p => p.is_native);

  const loadFieldMaps = useCallback(async () => {
    setLoadingMaps(true);
    try {
      const r = await fetch(`${API}/field-maps?domain_slug=${domain.slug}&provider_slug=${activeSlug}`, { headers: authHeaders() });
      if (r.ok) setFieldMaps(await r.json());
    } finally { setLoadingMaps(false); }
  }, [domain.slug, activeSlug]);

  const loadDefaults = useCallback(async () => {
    if (activeSlug === 'native') { setDefaults([]); return; }
    const r = await fetch(`${API}/field-maps/defaults/${domain.slug}/${activeSlug}`, { headers: authHeaders() });
    if (r.ok) {
      const data = await r.json();
      setDefaults(data);
      if (data.length > 0) setShowDefaultsSuggestion(true);
    }
  }, [domain.slug, activeSlug]);

  useEffect(() => {
    loadFieldMaps();
    loadDefaults();
  }, [loadFieldMaps, loadDefaults]);

  const activateProvider = async (providerSlug: string) => {
    setSwitching(true);
    try {
      if (providerSlug === 'native') {
        await fetch(`${API}/prefs/${domain.slug}`, { method: 'DELETE', headers: authHeaders() });
        setActiveSlug('native');
      } else {
        const r = await fetch(`${API}/prefs/${domain.slug}`, {
          method: 'PUT',
          headers: jsonHeaders(),
          body: JSON.stringify({ provider_slug: providerSlug }),
        });
        if (!r.ok) {
          const err = await r.json();
          alert(err.error || 'Cannot switch provider');
          return;
        }
        setActiveSlug(providerSlug);
      }
    } finally { setSwitching(false); }
  };

  const addFieldMap = async () => {
    if (!mapForm.external_field.trim() || !mapForm.native_field.trim()) return;
    setSavingMap(true);
    try {
      const r = await fetch(`${API}/field-maps`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          domain_slug: domain.slug,
          provider_slug: activeSlug,
          external_field: mapForm.external_field.trim(),
          native_field: mapForm.native_field.trim(),
          direction: mapForm.direction,
          transform: mapForm.transform.trim() || null,
        }),
      });
      if (r.ok) {
        setMapForm({ external_field: '', native_field: '', direction: 'inbound', transform: '' });
        setShowAddMap(false);
        loadFieldMaps();
      }
    } finally { setSavingMap(false); }
  };

  const deleteFieldMap = async (id: string) => {
    await fetch(`${API}/field-maps/${id}`, { method: 'DELETE', headers: authHeaders() });
    setFieldMaps(prev => prev.filter(m => m.id !== id));
  };

  const importDefaults = async () => {
    setSavingMap(true);
    try {
      await Promise.all(defaults.map(d =>
        fetch(`${API}/field-maps`, {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({
            domain_slug: domain.slug,
            provider_slug: activeSlug,
            external_field: d.external,
            native_field: d.native,
            direction: 'inbound',
            transform: null,
          }),
        })
      ));
      setShowDefaultsSuggestion(false);
      loadFieldMaps();
    } finally { setSavingMap(false); }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: `${domain.color}18` }}
          >
            <Globe className="w-4 h-4" style={{ color: domain.color }} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">{domain.name} — Provider Setup</h1>
            <p className="text-xs text-gray-400">{domain.description}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* Provider selection */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Available Providers</h2>
              <span className="text-xs text-gray-400">{providers.length} option{providers.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-3">
              {providers.map(provider => (
                <ProviderCard
                  key={provider.slug}
                  provider={provider}
                  isActive={activeSlug === provider.slug}
                  onActivate={() => activateProvider(provider.slug)}
                  onDeactivate={() => activateProvider('native')}
                  disabled={switching}
                />
              ))}
            </div>
          </div>

          {/* Active provider capabilities */}
          {activeProvider && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <button
                onClick={() => setCapabilitiesOpen(o => !o)}
                className="flex items-center justify-between w-full"
              >
                <h2 className="font-semibold text-gray-900">
                  {activeProvider.name} Capabilities
                </h2>
                {capabilitiesOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {capabilitiesOpen && (
                <div className="mt-4">
                  {activeProvider.capabilities?.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {activeProvider.capabilities.map(cap => (
                        <div key={cap} className="flex items-center gap-2 py-2 px-3 bg-gray-50 rounded-lg">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                          <span className="text-xs text-gray-700">{cap.replace(/_/g, ' ')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No capabilities listed for this provider.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Field mappings */}
          {activeSlug !== 'native' && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-gray-900">Field Mappings</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={loadFieldMaps}
                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setShowAddMap(v => !v)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#2563EB] text-white rounded-lg hover:bg-[#4a5be8] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add mapping
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                Map external provider fields to ContentFlow native fields. Used when syncing data.
              </p>

              {/* Default suggestion banner */}
              {showDefaultsSuggestion && defaults.length > 0 && (
                <div className="mb-4 flex items-start gap-3 p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-[#2563EB] flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 font-medium">Suggested mappings available</p>
                    <p className="text-xs text-gray-500 mt-0.5">We have {defaults.length} default field mappings for {domain.name} → {activeProvider?.name}.</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={importDefaults}
                      disabled={savingMap}
                      className="text-xs px-2.5 py-1 bg-[#2563EB] text-white rounded-lg hover:bg-[#4a5be8] transition-colors"
                    >
                      Import all
                    </button>
                    <button onClick={() => setShowDefaultsSuggestion(false)} className="text-xs text-gray-400 hover:text-gray-600 px-1">
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Add map form */}
              {showAddMap && (
                <div className="mb-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">External field</label>
                      <input
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2563EB] font-mono"
                        placeholder="e.g. firstname"
                        value={mapForm.external_field}
                        onChange={e => setMapForm(f => ({ ...f, external_field: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Native field</label>
                      <input
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2563EB] font-mono"
                        placeholder="e.g. first_name"
                        value={mapForm.native_field}
                        onChange={e => setMapForm(f => ({ ...f, native_field: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Direction</label>
                      <select
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2563EB] bg-white"
                        value={mapForm.direction}
                        onChange={e => setMapForm(f => ({ ...f, direction: e.target.value as any }))}
                      >
                        <option value="inbound">External → Native</option>
                        <option value="outbound">Native → External</option>
                        <option value="both">Bidirectional</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Transform <span className="text-gray-400">(optional)</span></label>
                      <input
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2563EB]"
                        placeholder="e.g. lowercase, trim"
                        value={mapForm.transform}
                        onChange={e => setMapForm(f => ({ ...f, transform: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowAddMap(false)} className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={addFieldMap}
                      disabled={savingMap || !mapForm.external_field.trim() || !mapForm.native_field.trim()}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[#2563EB] text-white rounded-lg hover:bg-[#4a5be8] disabled:opacity-50 transition-colors"
                    >
                      <Save className="w-3.5 h-3.5" /> Save
                    </button>
                  </div>
                </div>
              )}

              {/* Header row */}
              {fieldMaps.length > 0 && (
                <div className="flex items-center gap-3 px-3 mb-1">
                  <span className="text-xs text-gray-400 flex-1">External field</span>
                  <span className="w-3.5 flex-shrink-0" />
                  <span className="text-xs text-gray-400 flex-1">Native field</span>
                  <span className="text-xs text-gray-400 w-24 text-right flex-shrink-0">Direction</span>
                  <span className="w-5 flex-shrink-0" />
                </div>
              )}

              {loadingMaps ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-9 bg-gray-100 rounded-lg animate-pulse" />)}
                </div>
              ) : fieldMaps.length === 0 ? (
                <div className="text-center py-8">
                  <Settings className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No field mappings configured.</p>
                  <p className="text-xs text-gray-300 mt-0.5">Add mappings to control how data translates between systems.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {fieldMaps.map(m => (
                    <FieldMapRow key={m.id} map={m} onDelete={() => deleteFieldMap(m.id)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Integration tip */}
          {!providers.some(p => p.user_has_access && !p.is_native) && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-800 mb-0.5">No external providers connected</p>
                <p className="text-xs text-gray-500">
                  Go to <strong>Integrations</strong> to connect {domain.name.toLowerCase()} tools like{' '}
                  {providers.filter(p => !p.is_native).map(p => p.name).join(', ')}.
                  Once connected, you can activate them as your {domain.name.toLowerCase()} provider here.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
