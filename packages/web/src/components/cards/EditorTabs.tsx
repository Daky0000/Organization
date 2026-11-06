interface EditorTabsProps {
  tabs: string[];
  activeTab: string;
  onChange: (tab: string) => void;
}

const EditorTabs = ({ tabs, activeTab, onChange }: EditorTabsProps) => {
  return (
    <div className={`grid border-b border-slate-200 ${tabs.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`border-b-4 px-3 py-3 text-sm font-semibold transition-colors ${
            activeTab === tab
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
};

export default EditorTabs;
