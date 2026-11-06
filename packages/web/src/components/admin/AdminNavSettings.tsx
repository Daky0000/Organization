import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../utils/apiBase';

const tok = () => localStorage.getItem('auth_token') ?? '';
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` });
const authHeaders = () => ({ Authorization: `Bearer ${tok()}` });

interface NavItem {
  key: string;
  label: string;
  children?: { key: string; label: string }[];
}

const NAV_TREE: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'ai-team', label: 'AI Team' },
  {
    key: 'crm', label: 'CRM',
    children: [
      { key: 'crm-companies', label: 'Companies' },
      { key: 'crm-pipeline', label: 'Deals' },
      { key: 'crm-scoring', label: 'Lead Scoring' },
      { key: 'crm-gmail-agent', label: 'Gmail Agent' },
    ],
  },
  {
    key: 'sales', label: 'Sales',
    children: [
      { key: 'sales-leads', label: 'Leads' },
      { key: 'sales-conversations', label: 'Conversations' },
      { key: 'sales-followups', label: 'Follow-ups' },
      { key: 'sales-intelligence', label: 'Intelligence' },
      { key: 'sales-settings', label: 'Settings' },
    ],
  },
  {
    key: 'marketing', label: 'Marketing',
    children: [
      { key: 'marketing-overview', label: 'Overview' },
      // Content is a nested group inside Marketing — toggling `content` hides
      // the whole sub-tree, the `content-*` keys hide individual entries.
      { key: 'content', label: 'Content' },
      { key: 'content-posts', label: 'Content › Posts' },
      { key: 'content-automation', label: 'Content › Automation' },
      { key: 'content-media', label: 'Content › Media' },
      { key: 'content-studio', label: 'Content › AI Studio' },
      { key: 'content-workflow', label: 'Content › Workflow' },
      { key: 'analytics', label: 'Content › Analytics' },
      { key: 'marketing-contacts', label: 'Contacts' },
      { key: 'marketing-email', label: 'Email' },
      { key: 'marketing-campaigns', label: 'Campaigns' },
      { key: 'marketing-surveys', label: 'Surveys' },
      { key: 'marketing-automations', label: 'Automations' },
      { key: 'marketing-forms', label: 'Forms' },
      { key: 'marketing-leads', label: 'Lead Generation' },
      { key: 'marketing-leads-import', label: 'Lead Generation › Import' },
    ],
  },
  { key: 'integrations', label: 'Integrations' },
  {
    key: 'connectors', label: 'Connectors',
    children: [
      { key: 'connectors-hub', label: 'Hub' },
      { key: 'connectors-sync', label: 'Sync Dashboard' },
    ],
  },
  { key: 'billing', label: 'Billing' },
];

export default function AdminNavSettings() {
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/platform/nav-settings`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { setDisabled(new Set(d.disabled ?? [])); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (key: string, children?: { key: string }[]) => {
    setDisabled(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        // re-enable children too
        children?.forEach(c => next.delete(c.key));
      } else {
        next.add(key);
        // disable all children when parent is disabled
        children?.forEach(c => next.add(c.key));
      }
      return next;
    });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`${API_BASE_URL}/api/admin/nav-settings`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ disabled: Array.from(disabled) }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading…</div>;
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Navigation Visibility</h2>
        <p className="text-sm text-gray-500 mt-1">
          Toggle nav items off to hide them from all users. Admins always see every item.
          Disabling a parent hides the entire section including sub-items.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        {NAV_TREE.map(item => {
          const isDisabled = disabled.has(item.key);
          const parentDisabled = isDisabled;
          return (
            <div key={item.key}>
              {/* Parent row */}
              <div className={`flex items-center justify-between px-5 py-4 ${isDisabled ? 'bg-gray-50' : ''}`}>
                <div>
                  <p className={`text-sm font-medium ${isDisabled ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {item.label}
                  </p>
                  {item.children && (
                    <p className="text-xs text-gray-400 mt-0.5">{item.children.length} sub-items</p>
                  )}
                </div>
                <button
                  onClick={() => toggle(item.key, item.children)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isDisabled ? 'bg-gray-200' : 'bg-[#2563EB]'}`}
                  role="switch"
                  aria-checked={!isDisabled}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isDisabled ? 'translate-x-1' : 'translate-x-6'}`} />
                </button>
              </div>

              {/* Sub-items */}
              {item.children && !parentDisabled && (
                <div className="bg-gray-50/50 border-t border-gray-100">
                  {item.children.map(child => {
                    const childDisabled = disabled.has(child.key);
                    return (
                      <div key={child.key} className={`flex items-center justify-between pl-10 pr-5 py-3 border-b border-gray-100 last:border-0 ${childDisabled ? 'opacity-60' : ''}`}>
                        <p className={`text-sm ${childDisabled ? 'text-gray-400 line-through' : 'text-gray-600'}`}>
                          {child.label}
                        </p>
                        <button
                          onClick={() => toggle(child.key)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${childDisabled ? 'bg-gray-200' : 'bg-[#2563EB]'}`}
                          role="switch"
                          aria-checked={!childDisabled}
                        >
                          <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${childDisabled ? 'translate-x-1' : 'translate-x-5'}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#4a5be8] disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        {saved && <span className="text-sm text-emerald-600 font-medium">Saved ✓</span>}
      </div>
    </div>
  );
}
