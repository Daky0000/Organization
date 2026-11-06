import { useState } from 'react';
import { Zap } from 'lucide-react';
import { ManagedUser } from '../../types/admin';

interface GrantCreditsModalProps {
  user: ManagedUser | null;
  onClose: () => void;
  onGrant: (userId: string, amount: number) => Promise<void>;
}

const QUICK_AMOUNTS = [100, 500, 1000, 2000];

const GrantCreditsModal = ({ user, onClose, onGrant }: GrantCreditsModalProps) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(amount, 10);
    if (!n || n <= 0) { setError('Enter a valid amount'); return; }
    setLoading(true);
    setError(null);
    try {
      await onGrant(user.id, n);
      setSuccess(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant credits');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50">
              <Zap size={18} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-950">Grant Credits</h2>
              <p className="text-sm text-slate-500">{user.name} · {user.email}</p>
            </div>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="px-6 py-6 space-y-5">
          <div className="flex gap-2 flex-wrap">
            {QUICK_AMOUNTS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmount(String(q))}
                className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  amount === String(q)
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                +{q.toLocaleString()}
              </button>
            ))}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Custom amount</label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 200"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          {success && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Credits granted successfully!
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || success}
              className="flex-1 rounded-2xl bg-slate-950 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? 'Granting…' : `Grant ${amount ? parseInt(amount, 10).toLocaleString() : ''} Credits`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GrantCreditsModal;
