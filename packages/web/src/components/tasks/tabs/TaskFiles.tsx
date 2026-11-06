import { useEffect, useState } from 'react';
import { Download, File, FileImage, FileText, FileVideo } from 'lucide-react';
import { apiFetch } from '../TasksPage';
import { TaskAttachment } from '../taskTypes';

type FileRow = TaskAttachment & { task_title: string; task_id: string };

function fileIcon(mime: string | null) {
  if (!mime) return File;
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.includes('pdf') || mime.includes('text')) return FileText;
  return File;
}

function formatBytes(n: number | null) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskFiles({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ files: FileRow[] }>(`/api/projects/${projectId}/files`)
      .then((d) => setFiles(d.files))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-gray-100" />;

  if (!files.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <File size={28} className="mx-auto mb-2 text-gray-300" />
        <p className="text-sm font-semibold text-gray-500">No files yet</p>
        <p className="mt-1 text-xs text-gray-400">Attach files to tasks and they'll appear here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-5 py-3">
        <p className="text-sm font-bold text-gray-900">Project Files ({files.length})</p>
      </div>
      <div className="divide-y divide-gray-100">
        {files.map((f) => {
          const Icon = fileIcon(f.mime_type);
          return (
            <div key={f.id} className="flex items-center gap-3 px-5 py-3">
              <Icon size={18} className="shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-gray-900">{f.name}</p>
                <p className="text-[11px] text-gray-400">
                  {f.task_title} · {f.uploader_name ?? 'Unknown'} · {new Date(f.created_at).toLocaleDateString()}
                  {f.size ? ` · ${formatBytes(f.size)}` : ''}
                </p>
              </div>
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                title="Download / view"
              >
                <Download size={14} />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
