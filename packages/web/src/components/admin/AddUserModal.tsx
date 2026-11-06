import { FormEvent, useState } from 'react';
import { CreateUserInput } from '../../types/admin';

interface AddUserModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateUserInput) => Promise<void>;
}

const fieldClassName =
  'h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400';

const AddUserModal = ({ open, onClose, onCreate }: AddUserModalProps) => {
  const [form, setForm] = useState<CreateUserInput>({
    name: '',
    email: '',
    username: '',
    password: '',
    role: 'User',
    status: 'Active',
  });

  if (!open) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onCreate(form);
    setForm({
      name: '',
      email: '',
      username: '',
      password: '',
      role: 'User',
      status: 'Active',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-8">
      <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-black text-slate-950">Add New User</h3>
            <p className="mt-1 text-sm text-slate-500">Create a new platform account and set the initial role.</p>
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
            <input value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password" type="password" className={fieldClassName} />
            <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as CreateUserInput['role'] }))} className={fieldClassName}>
              {['Admin', 'User'].map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as CreateUserInput['status'] }))} className={fieldClassName}>
              {['Active', 'Pending'].map((status) => (
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
              Create User
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddUserModal;
