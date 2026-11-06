interface ScheduledPost {
  id: number;
  title: string;
  platforms: string[];
  scheduledTime: string;
  recurrence: string;
}

const ScheduleManager = () => {
  const scheduledPosts: ScheduledPost[] = [
    {
      id: 1,
      title: 'Weekly Motivation Monday',
      platforms: ['Instagram', 'Twitter'],
      scheduledTime: 'Tomorrow at 9:00 AM',
      recurrence: 'Weekly',
    },
    {
      id: 2,
      title: 'Friday Roundup',
      platforms: ['LinkedIn'],
      scheduledTime: 'Friday at 2:00 PM',
      recurrence: 'Weekly',
    },
  ];

  const timezones = [
    { name: 'EST', offset: '-5:00', engagement: '8.2%' },
    { name: 'CST', offset: '-6:00', engagement: '7.1%' },
    { name: 'MST', offset: '-7:00', engagement: '6.9%' },
    { name: 'PST', offset: '-8:00', engagement: '9.5%' },
    { name: 'UTC', offset: '+0:00', engagement: '5.2%' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Scheduled Posts</h3>
        
        {scheduledPosts.map(post => (
          <div key={post.id} className="border-b border-gray-200 pb-4 last:border-b-0 mb-4 last:mb-0">
            <h4 className="font-bold text-gray-900">{post.title}</h4>
            <p className="text-sm text-gray-600 mt-1">📅 {post.scheduledTime}</p>
            <p className="text-sm text-gray-600">🔄 {post.recurrence}</p>
            <div className="flex gap-2 mt-2">
              {post.platforms.map(platform => (
                <span key={platform} className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold">
                  {platform}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Best Posting Times */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="font-bold text-gray-900 mb-4">Best Posting Times by Timezone</h3>
        <div className="space-y-2">
          {timezones.map(tz => (
            <div key={tz.name} className="flex items-center justify-between p-3 bg-gray-50 rounded">
              <span className="font-bold text-gray-900">{tz.name} ({tz.offset})</span>
              <span className="text-green-600 font-bold">9:00 AM 🔥</span>
              <span className="text-gray-600">{tz.engagement} engagement</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ScheduleManager;
