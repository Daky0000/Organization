import { useState } from 'react';
import {
  BarChart2, Bookmark, ChevronLeft, ChevronRight, Globe2, Heart, MessageCircle, Music2, Play, Repeat2, Send, Share2, ThumbsUp,
} from 'lucide-react';
import { PlatformLogo } from '../PlatformLogo';
import type { MediaAsset, SocialPlatformId } from './socialMeta';

// How the post will look on its platform — the same layout the platform uses,
// so what is edited is what gets published.

type Props = {
  platform: SocialPlatformId;
  format: string;
  text: string;
  media: MediaAsset[];
  name?: string;
  handle?: string;
};

function Avatar({ size = 32, ring = false }: { size?: number; ring?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-[11px] font-bold text-white ${ring ? 'ring-2 ring-pink-500 ring-offset-2' : ''}`}
      style={{ width: size, height: size }}>
      YB
    </span>
  );
}

/** Media frame: a carousel with arrows and dots, a video with a play badge, or a single image. */
function MediaFrame({ media, aspect, rounded = '' }: { media: MediaAsset[]; aspect: string; rounded?: string }) {
  const [i, setI] = useState(0);
  if (!media.length) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 text-[11px] text-slate-400 ${rounded}`} style={{ aspectRatio: aspect }}>
        No media yet
      </div>
    );
  }
  const cur = media[Math.min(i, media.length - 1)];
  const isVideo = cur.type === 'video' || /\.(mp4|mov|m4v|webm)(\?|$)/i.test(cur.url);
  return (
    <div className={`relative overflow-hidden bg-black ${rounded}`} style={{ aspectRatio: aspect }}>
      {isVideo
        ? <video src={cur.url} className="h-full w-full object-cover" controls playsInline preload="metadata" />
        : <img src={cur.url} alt={cur.caption || ''} className="h-full w-full object-cover" />}
      {media.length > 1 && (
        <>
          <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">{i + 1}/{media.length}</span>
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} aria-label="Previous slide"
              className="absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow">
              <ChevronLeft size={15} />
            </button>
          )}
          {i < media.length - 1 && (
            <button type="button" onClick={() => setI(i + 1)} aria-label="Next slide"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow">
              <ChevronRight size={15} />
            </button>
          )}
        </>
      )}
      {isVideo && media.length === 1 && (
        <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white"><Play size={10} /> Video</span>
      )}
    </div>
  );
}

function Dots({ count, platform }: { count: number; platform: SocialPlatformId }) {
  if (count < 2) return null;
  return (
    <div className="flex justify-center gap-1 py-1.5">
      {Array.from({ length: Math.min(count, 10) }, (_, k) => (
        <span key={k} className={`h-1.5 w-1.5 rounded-full ${k === 0 ? (platform === 'instagram' ? 'bg-sky-500' : 'bg-slate-700') : 'bg-slate-300'}`} />
      ))}
    </div>
  );
}

function Caption({ text, lines = 3, prefix }: { text: string; lines?: number; prefix?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.split('\n').length > lines || text.length > lines * 70;
  return (
    <div className="whitespace-pre-wrap break-words text-[13px] leading-snug text-slate-900">
      <span className={open ? '' : 'line-clamp-3'} style={open ? undefined : { WebkitLineClamp: lines }}>
        {prefix && <span className="mr-1 font-semibold">{prefix}</span>}
        {text || <span className="text-slate-400">No caption yet</span>}
      </span>
      {long && !open && <button type="button" onClick={() => setOpen(true)} className="text-slate-500">… more</button>}
    </div>
  );
}

export default function SocialPostPreview({ platform, format, text, media, name = 'Your Brand', handle = 'yourbrand' }: Props) {
  const vertical = format === 'reel' || format === 'video' || format === 'story';

  if (platform === 'instagram') {
    if (vertical) return <VerticalPreview platform={platform} text={text} media={media} handle={handle} />;
    return (
      <div className="w-full max-w-[360px] overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-3 py-2">
          <Avatar size={30} ring />
          <span className="text-[13px] font-semibold text-slate-900">{handle}</span>
          <span className="ml-auto text-slate-400">•••</span>
        </div>
        <MediaFrame media={media} aspect="4 / 5" />
        <div className="flex items-center gap-3.5 px-3 pt-2 text-slate-900">
          <Heart size={21} /><MessageCircle size={21} /><Send size={21} />
          <Bookmark size={21} className="ml-auto" />
        </div>
        <Dots count={media.length} platform={platform} />
        <div className="space-y-1 px-3 pb-3">
          <p className="text-[13px] font-semibold text-slate-900">1,024 likes</p>
          <Caption text={text} prefix={handle} />
        </div>
      </div>
    );
  }

  if (platform === 'x' || platform === 'threads') {
    return (
      <div className="w-full max-w-[400px] rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex gap-2.5">
          <Avatar size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[13px]">
              <span className="font-bold text-slate-900">{name}</span>
              <span className="truncate text-slate-500">@{handle} · 1h</span>
            </div>
            <div className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-snug text-slate-900">{text || <span className="text-slate-400">No text yet</span>}</div>
            {media.length > 0 && <div className="mt-2"><MediaFrame media={media} aspect={platform === 'x' ? '16 / 9' : '4 / 5'} rounded="rounded-2xl border border-slate-200" /></div>}
            <div className="mt-2 flex justify-between pr-6 text-slate-500">
              <MessageCircle size={16} /><Repeat2 size={16} /><Heart size={16} />{platform === 'x' ? <BarChart2 size={16} /> : <Send size={16} />}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (platform === 'linkedin' || platform === 'facebook') {
    const li = platform === 'linkedin';
    return (
      <div className="w-full max-w-[420px] overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-start gap-2 px-3 pt-3">
          <Avatar size={40} />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">{name}</p>
            <p className="flex items-center gap-1 text-[11px] text-slate-500">{li ? '2,481 followers · 1h ·' : 'Just now ·'} <Globe2 size={10} /></p>
          </div>
        </div>
        <div className="px-3 py-2"><Caption text={text} lines={li ? 3 : 4} /></div>
        {media.length > 0 && <MediaFrame media={media} aspect={li ? (format === 'carousel' ? '1 / 1' : '1.91 / 1') : (format === 'carousel' ? '1 / 1' : '4 / 5')} />}
        <div className="flex justify-around border-t border-slate-100 px-2 py-1.5 text-[12px] font-semibold text-slate-600">
          <span className="flex items-center gap-1"><ThumbsUp size={15} /> Like</span>
          <span className="flex items-center gap-1"><MessageCircle size={15} /> Comment</span>
          <span className="flex items-center gap-1">{li ? <Repeat2 size={15} /> : <Share2 size={15} />} {li ? 'Repost' : 'Share'}</span>
          {li && <span className="flex items-center gap-1"><Send size={15} /> Send</span>}
        </div>
      </div>
    );
  }

  if (platform === 'pinterest') {
    return (
      <div className="w-full max-w-[260px]">
        <MediaFrame media={media} aspect="2 / 3" rounded="rounded-2xl" />
        <p className="mt-2 line-clamp-2 text-[13px] font-semibold text-slate-900">{text.split('\n')[0] || 'Pin title'}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500"><Avatar size={18} /> {name}</p>
      </div>
    );
  }

  // TikTok, YouTube Shorts, and vertical formats elsewhere.
  return <VerticalPreview platform={platform} text={text} media={media} handle={handle} />;
}

function VerticalPreview({ platform, text, media, handle }: { platform: SocialPlatformId; text: string; media: MediaAsset[]; handle: string }) {
  return (
    <div className="relative w-full max-w-[260px] overflow-hidden rounded-2xl bg-black">
      <MediaFrame media={media} aspect="9 / 16" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/80 to-transparent p-3 pr-12 text-white">
        <p className="text-[13px] font-semibold">@{handle}</p>
        <p className="line-clamp-3 whitespace-pre-wrap text-[12px] leading-snug">{text}</p>
        {platform === 'tiktok' && <p className="flex items-center gap-1 text-[11px]"><Music2 size={11} /> Original sound</p>}
      </div>
      <div className="pointer-events-none absolute bottom-16 right-2 flex flex-col items-center gap-3 text-white">
        <Heart size={22} /><MessageCircle size={22} />{platform === 'instagram' ? <Send size={22} /> : <Share2 size={22} />}
      </div>
      <span className="pointer-events-none absolute left-2 top-2"><PlatformLogo platform={platform} size={20} /></span>
    </div>
  );
}
