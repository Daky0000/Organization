import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, FileText, Film, ImageIcon, Upload, X } from 'lucide-react';
import { compressImage, formatBytes } from '../utils/imageCompression';

type Props = {
  onUpload: (files: File[]) => Promise<void>;
  onClose?: () => void;
  multiple?: boolean;
  accept?: string;
};

type FileEntry = {
  file: File;
  preview: string | null; // data URL for images, null for others
};

export default function FileUploadDropzone({ onUpload, onClose, multiple = false, accept }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(false), 2500);
    return () => clearTimeout(t);
  }, [success]);

  const processFiles = useCallback(async (rawFiles: File[]) => {
    const toAdd = multiple ? rawFiles : rawFiles.slice(0, 1);
    const newEntries: FileEntry[] = await Promise.all(
      toAdd.map(async (file) => {
        if (file.type.startsWith('image/')) {
          try {
            const compressed = await compressImage(file);
            return { file, preview: compressed.thumbnail_url };
          } catch {
            return { file, preview: null };
          }
        }
        return { file, preview: null };
      }),
    );
    setEntries(prev => (multiple ? [...prev, ...newEntries] : newEntries));
    setSuccess(false);
  }, [multiple]);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void processFiles(files);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) void processFiles(files);
    e.target.value = '';
  };

  const removeEntry = (idx: number) => {
    setEntries(prev => prev.filter((_, i) => i !== idx));
    setSuccess(false);
  };

  const handleUpload = async () => {
    if (!entries.length || uploading) return;
    setUploading(true);
    try {
      await onUpload(entries.map(e => e.file));
      setSuccess(true);
      setEntries([]);
    } catch {
      // keep entries so user can retry
    } finally {
      setUploading(false);
    }
  };

  const fileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <ImageIcon size={20} className="text-indigo-500" />;
    if (file.type.startsWith('video/')) return <Film size={20} className="text-indigo-500" />;
    return <FileText size={20} className="text-indigo-500" />;
  };

  return (
    <div className="flex min-h-[340px] w-full flex-col items-center justify-center rounded-2xl bg-[#f0f0ff] p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        {/* Header row */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Upload file</h3>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Success state */}
        {success ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle size={48} className="text-indigo-500" />
            <p className="text-base font-semibold text-slate-800">File successfully uploaded!</p>
          </div>
        ) : (
          <>
            {/* Drop zone */}
            <div
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 transition-colors ${
                dragging
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/40'
              }`}
            >
              {/* Stacked icons */}
              <div className="flex items-end gap-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm">
                  <ImageIcon size={18} className="text-indigo-500" />
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-md">
                  <Film size={20} className="text-indigo-500" />
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm">
                  <FileText size={18} className="text-indigo-500" />
                </div>
              </div>

              <p className="text-center text-sm text-slate-600 leading-relaxed">
                Drag &amp; drop{' '}
                <span className="font-semibold text-indigo-600">images</span>,{' '}
                <span className="font-semibold text-indigo-600">videos</span>, or any{' '}
                <span className="font-semibold text-indigo-600">file</span>
              </p>
              <p className="text-xs text-slate-400">
                or{' '}
                <span className="cursor-pointer underline text-indigo-500 hover:text-indigo-700">
                  browse files on your computer
                </span>
              </p>

              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple={multiple}
                accept={accept}
                onChange={onInputChange}
              />
            </div>

            {/* File preview list */}
            {entries.length > 0 && (
              <ul className="mt-4 space-y-2">
                {entries.map((entry, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"
                  >
                    {/* Thumbnail or icon */}
                    {entry.preview ? (
                      <img
                        src={entry.preview}
                        alt={entry.file.name}
                        className="h-10 w-10 rounded-lg object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                        {fileIcon(entry.file)}
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-800">{entry.file.name}</p>
                      <p className="text-[11px] text-slate-400">
                        {entry.file.type || 'Unknown type'} · {formatBytes(entry.file.size)}
                      </p>
                    </div>

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => removeEntry(idx)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-red-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove file"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Upload button */}
            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={!entries.length || uploading}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {uploading ? (
                <>
                  <span className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full bg-white animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </span>
                  Uploading…
                </>
              ) : (
                <>
                  <Upload size={15} />
                  Upload
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
