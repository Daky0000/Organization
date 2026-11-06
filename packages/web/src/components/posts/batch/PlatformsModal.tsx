import { useMemo, useState } from 'react';
import type { SocialAccount } from '../../../services/socialPostService';

interface PlatformsModalProps {
  count: number;
  accounts: SocialAccount[];
  onSubmit: (accountIds: string[]) => Promise<void>;
  onClose: () => void;
}

const PlatformsModal = ({ count, accounts, onSubmit, onClose }: PlatformsModalProps) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const grouped = useMemo(() => {
    return [...accounts].sort((a, b) => a.platform.localeCompare(b.platform));
  }, [accounts]);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async () => {
    if (selected.length === 0) {
      alert('Select at least one platform account.');
      return;
    }
    setLoading(true);
    try {
      await onSubmit(selected);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Update platforms for {count} posts</h3>
        <p className="mt-1 text-sm text-slate-500">Choose the social accounts these posts should publish to.</p>

        <div className="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
          {grouped.length === 0 ? (
            <div className="text-xs text-slate-500">No connected social accounts found.</div>
          ) : (
            grouped.map((account) => (
              <label key={account.id} className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={selected.includes(account.id)}
                  onChange={() => toggle(account.id)}
                  className="rounded border-slate-300"
                />
                {account.profile_image && <img src={account.profile_image} alt="" className="h-5 w-5 rounded-full" />}
                <span className="capitalize">{account.platform}</span>
                <span className="text-slate-400">-</span>
                <span className="truncate">{account.account_name}</span>
              </label>
            ))
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="flex-1 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            disabled={loading}
          >
            {loading ? 'Updating...' : 'Apply Platforms'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlatformsModal;
