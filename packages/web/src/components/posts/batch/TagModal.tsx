import { useMemo, useState } from 'react';
import type { BlogTag } from '../../../services/blogService';

interface TagModalProps {
  count: number;
  tags: BlogTag[];
  onSubmit: (tagIds: string[]) => Promise<void>;
  onCreateTag: (name: string) => Promise<BlogTag | null>;
  onClose: () => void;
}

const TagModal = ({ count, tags, onSubmit, onCreateTag, onClose }: TagModalProps) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [loading, setLoading] = useState(false);
  const sortedTags = useMemo(() => [...tags].sort((a, b) => a.name.localeCompare(b.name)), [tags]);

  const toggleTag = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((tagId) => tagId !== id) : [...prev, id]));
  };

  const handleCreateTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    setLoading(true);
    try {
      const created = await onCreateTag(name);
      if (created) {
        setSelected((prev) => [...prev, created.id]);
        setNewTag('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (selected.length === 0) {
      alert('Select at least one tag.');
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
        <h3 className="text-lg font-semibold text-slate-900">Tag {count} posts</h3>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">Existing tags</label>
            <div className="flex flex-wrap gap-2">
              {sortedTags.length === 0 ? (
                <span className="text-xs text-slate-400">No tags yet.</span>
              ) : (
                sortedTags.map((tag) => {
                  const active = selected.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {tag.name}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2">Create new tag</label>
            <div className="flex gap-2">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                placeholder="Tag name"
              />
              <button
                type="button"
                onClick={handleCreateTag}
                disabled={loading || !newTag.trim()}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                Add
              </button>
            </div>
          </div>
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
            {loading ? 'Saving...' : 'Apply tags'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TagModal;
