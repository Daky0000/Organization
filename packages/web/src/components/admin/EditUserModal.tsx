import { FormEvent, useEffect, useState } from 'react';
import { ManagedUser, UpdateUserInput } from '../../types/admin';

interface EditUserModalProps {
  user: ManagedUser | null;
  open: boolean;
  onClose: () => void;
  onSave: (id: string, input: UpdateUserInput) => Promise<void>;
}

const fieldClassName =
  'h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400';

const EditUserModal = ({ user, open, onClose, onSave }: EditUserModalProps) => {
  const [form, setForm] = useState<UpdateUserInput>({
    name: '',
    email: '',
    username: '',
    role: 'User',
    status: 'Active',
    avatar: '',
  });

  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
      avatar: user.avatar,
    });
  }, [user]);

  if (!open || !user) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave(user.id, form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-8">
      <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-black text-slate-950">Edit User</h3>
            <p className="mt-1 text-sm text-slate-500">Update account details, role, status, and profile image.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Name" className={fieldClassName} />
            <input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="Email" type="email" className={fieldClassName} />
            <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="Username" className={fieldClassName} />
            <input value={form.avatar} onChange={(event) => setForm((current) => ({ ...current, avatar: event.target.value }))} placeholder="Profile image URL" className={fieldClassName} />
            <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as UpdateUserInput['role'] }))} className={fieldClassName}>
              {['Admin', 'User'].map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as UpdateUserInput['status'] }))} className={fieldClassName}>
              {['Active', 'Pending', 'Suspended', 'Banned'].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">
              Cancel
            </button>
            <button type="submit" className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">
              Save User
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditUserModal;
