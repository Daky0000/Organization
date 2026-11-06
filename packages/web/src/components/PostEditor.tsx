import { useState } from 'react';
import { X, Wand2 } from 'lucide-react';

interface Post {
  id?: string;
  title: string;
  content: string;
  platforms: string[];
}

interface PostEditorProps {
  onClose: () => void;
  onPublish: (post: Post) => void;
}

const PostEditor = ({ onClose, onPublish }: PostEditorProps) => {
  const [post, setPost] = useState<Post>({
    title: '',
    content: '',
    platforms: [],
  });

  const [selectedTone, setSelectedTone] = useState('professional');
  const [showAISuggestions, setShowAISuggestions] = useState(false);

  const platforms = ['Instagram', 'Twitter', 'LinkedIn', 'Facebook', 'TikTok', 'YouTube'];
  const tones = ['Professional', 'Casual', 'Sales', 'Educational', 'Inspirational'];

  const aiSuggestions = [
    { id: 1, text: 'Discover the power of AI-driven content creation...' },
    { id: 2, text: 'Transform your social media strategy with automation...' },
    { id: 3, text: 'Maximize engagement through intelligent distribution...' },
  ];

  const togglePlatform = (platform: string) => {
    setPost(prev => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter(p => p !== platform)
        : [...prev.platforms, platform]
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-96 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Create Post</h2>
          <button onClick={onClose} className="p-1 hover:bg-white hover:bg-opacity-20 rounded">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Post Title</label>
            <input
              type="text"
              value={post.title}
              onChange={(e) => setPost({ ...post, title: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Enter post title..."
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Content</label>
            <textarea
              value={post.content}
              onChange={(e) => setPost({ ...post, content: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 h-24"
              placeholder="Write your content..."
            />
          </div>

          {/* Tone Selection */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Tone</label>
            <div className="flex gap-2 flex-wrap">
              {tones.map(tone => (
                <button
                  key={tone}
                  onClick={() => setSelectedTone(tone.toLowerCase())}
                  className={`px-3 py-1 rounded-full text-sm font-bold transition-colors ${
                    selectedTone === tone.toLowerCase()
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {tone}
                </button>
              ))}
            </div>
          </div>

          {/* AI Suggestions */}
          <button
            onClick={() => setShowAISuggestions(!showAISuggestions)}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-bold"
          >
            <Wand2 size={18} />
            AI Rewrite Suggestions
          </button>

          {showAISuggestions && (
            <div className="bg-blue-50 rounded-lg p-3 space-y-2">
              {aiSuggestions.map(suggestion => (
                <button
                  key={suggestion.id}
                  onClick={() => setPost({ ...post, content: suggestion.text })}
                  className="w-full text-left p-2 bg-white hover:bg-blue-100 rounded transition-colors text-sm"
                >
                  {suggestion.text}
                </button>
              ))}
            </div>
          )}

          {/* Platforms */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Select Platforms</label>
            <div className="grid grid-cols-3 gap-2">
              {platforms.map(platform => (
                <button
                  key={platform}
                  onClick={() => togglePlatform(platform)}
                  className={`px-3 py-2 rounded-lg text-sm font-bold transition-colors ${
                    post.platforms.includes(platform)
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {platform}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={() => onPublish(post)}
              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 rounded-lg transition-colors"
            >
              Publish Now
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-900 font-bold py-2 rounded-lg transition-colors"
            >
              Save as Draft
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PostEditor;
