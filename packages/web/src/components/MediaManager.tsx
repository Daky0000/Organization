interface MediaItem {
  id: number;
  name: string;
  size: number;
  type: string;
  uploaded: string;
  downloads: number;
}

const MediaManager = () => {
  const mediaItems: MediaItem[] = [
    { id: 1, name: 'summer-campaign.jpg', size: 2.4, type: 'image', uploaded: '2 days ago', downloads: 5 },
    { id: 2, name: 'team-photo.png', size: 3.1, type: 'image', uploaded: '1 week ago', downloads: 12 },
    { id: 3, name: 'product-demo.mp4', size: 45.8, type: 'video', uploaded: '2 weeks ago', downloads: 8 },
    { id: 4, name: 'infographic.gif', size: 5.2, type: 'image', uploaded: '3 weeks ago', downloads: 15 },
  ];

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <div className="border-2 border-dashed border-blue-400 rounded-lg p-8 text-center bg-blue-50">
        <p className="text-xl font-bold text-gray-900 mb-2">Drop files here</p>
        <p className="text-gray-600">or click to browse</p>
      </div>

      {/* Storage Usage */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="font-bold text-gray-900 mb-4">Storage Usage</h3>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div className="bg-blue-500 h-4 rounded-full" style={{ width: '24.5%' }}></div>
            </div>
          </div>
          <span className="font-bold text-gray-900">245 / 1000 GB</span>
        </div>
      </div>

      {/* Media Library */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="font-bold text-gray-900 mb-4">Your Media</h3>
        <div className="space-y-3">
          {mediaItems.map(item => (
            <div key={item.id} className="flex items-center justify-between p-4 bg-gray-50 rounded">
              <div className="flex-1">
                <p className="font-bold text-gray-900">{item.name}</p>
                <p className="text-sm text-gray-600">{item.size} MB • Uploaded {item.uploaded}</p>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-bold">
                  Copy URL
                </button>
                <button className="px-3 py-1 bg-gray-300 hover:bg-gray-400 text-gray-900 rounded text-sm font-bold">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MediaManager;
