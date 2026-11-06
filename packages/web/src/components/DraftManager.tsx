interface Draft {
  id: number;
  title: string;
  platforms: string[];
  content: string;
  wordCount: number;
  lastEdited: string;
  autoSaveTime: string;
}

const DraftManager = () => {
  const drafts: Draft[] = [
    {
      id: 1,
      title: 'Q1 Marketing Strategy',
      platforms: ['Twitter', 'LinkedIn'],
      content: 'Comprehensive guide to Q1 marketing initiatives...',
      wordCount: 450,
      lastEdited: '2 hours ago',
      autoSaveTime: '30s',
    },
    {
      id: 2,
      title: 'Product Launch Announcement',
      platforms: ['Instagram', 'Facebook', 'Twitter'],
      content: 'Excited to announce our newest product feature...',
      wordCount: 320,
      lastEdited: '5 hours ago',
      autoSaveTime: '1min',
    },
    {
      id: 3,
      title: 'Team Insights Blog',
      platforms: ['LinkedIn'],
      content: 'Behind the scenes look at how our team collaborates...',
      wordCount: 680,
      lastEdited: '1 day ago',
      autoSaveTime: '5min',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Your Drafts</h3>
        
        {drafts.map(draft => (
          <div key={draft.id} className="border-b border-gray-200 pb-4 last:border-b-0 mb-4 last:mb-0">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="font-bold text-gray-900">{draft.title}</h4>
                <p className="text-sm text-gray-600 mt-1">📝 {draft.wordCount} words</p>
                <p className="text-sm text-gray-600">Last edited: {draft.lastEdited}</p>
                <div className="flex gap-2 mt-2">
                  {draft.platforms.map(platform => (
                    <span key={platform} className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-bold">
                      {platform}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded font-bold text-sm">
                  Edit
                </button>
                <button className="px-3 py-1 bg-gray-300 hover:bg-gray-400 text-gray-900 rounded font-bold text-sm">
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Auto-Save Settings */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-bold text-gray-900 mb-4">Auto-Save Configuration</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="autosave" value="30s" defaultChecked className="w-4 h-4" />
            <span className="text-gray-700">Every 30 seconds</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="autosave" value="1min" className="w-4 h-4" />
            <span className="text-gray-700">Every 1 minute</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="autosave" value="5min" className="w-4 h-4" />
            <span className="text-gray-700">Every 5 minutes</span>
          </label>
        </div>
      </div>
    </div>
  );
};

export default DraftManager;
