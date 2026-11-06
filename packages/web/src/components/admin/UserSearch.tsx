interface UserSearchProps {
  value: string;
  onChange: (value: string) => void;
}

const UserSearch = ({ value, onChange }: UserSearchProps) => (
  <input
    type="search"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    placeholder="Search by name, email, username, or user ID"
    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400"
  />
);

export default UserSearch;
