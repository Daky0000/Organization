import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Heart,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Music2,
  Play,
  Repeat2,
  Send,
  Share2,
  ThumbsUp,
  VolumeX,
} from 'lucide-react';
import { blogService, type BlogPost } from '../../services/blogService';
import { socialTemplateService, type SocialTemplatePreview, type SocialTemplateSettings } from '../../services/socialTemplateService';
import { PlatformLogo } from '../PlatformLogo';
import { getNetworkConfig } from './networkConfig';

const HASHTAG_REGEX = /#[\p{L}0-9_]+/gu;
const URL_REGEX = /https?:\/\/[^\s]+/g;
const TRAILING_URL_PUNCT = /[)\],.!?:;]+$/;

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeUrlCandidate(value: string) {
  return String(value || '').trim().replace(TRAILING_URL_PUNCT, '');
}

function extractUrls(text: string): string[] {
  const matches = Array.from(String(text || '').matchAll(URL_REGEX), (match) => normalizeUrlCandidate(match[0] || ''));
  return uniqueStrings(matches);
}

function stripUrls(text: string): string {
  return String(text || '')
    .replace(URL_REGEX, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname || '';
    return hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function extractHashtags(text: string): string[] {
  const matches = Array.from(String(text || '').matchAll(HASHTAG_REGEX), (match) => String(match[0] || '').trim());
  return uniqueStrings(matches);
}

function stripHashtags(text: string): string {
  return String(text || '')
    .replace(HASHTAG_REGEX, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatHashtags(text: string, hashtagClass = 'font-bold text-blue-700') {
  const value = String(text || '');
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of value.matchAll(HASHTAG_REGEX)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const tag = match[0] || '';
    if (!tag) continue;

    if (index > lastIndex) {
      nodes.push(value.slice(lastIndex, index));
    }

    nodes.push(
      <span key={`tag-${key++}-${index}`} className={hashtagClass}>
        {tag}
      </span>
    );

    lastIndex = index + tag.length;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes.length ? nodes : value;
}

function PreviewImage({ url, aspectClass }: { url: string; aspectClass: string }) {
  const src = String(url || '').trim();
  if (!src) {
    return (
      <div
        className={`w-full ${aspectClass} bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center`}
      >
        <div className="flex flex-col items-center text-slate-400">
          <ImageIcon size={28} className="mb-2" />
          <div className="text-xs font-semibold">No featured image</div>
        </div>
      </div>
    );
  }

  return <img src={src} alt="Featured" className={`w-full ${aspectClass} object-cover`} />;
}

function InstagramPreviewCard({ caption, imageUrl }: { caption: string; imageUrl: string }) {
  const username = 'your_instagram';
  return (
    <div className="max-w-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="h-9 w-9 overflow-hidden rounded-full bg-slate-100 flex items-center justify-center">
          <PlatformLogo platform="instagram" size={30} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">{username}</div>
          <div className="text-xs text-slate-500">Preview</div>
        </div>
        <button type="button" className="text-slate-400 hover:text-slate-600" aria-label="More">
          <MoreHorizontal size={18} />
        </button>
      </div>

      <PreviewImage url={imageUrl} aspectClass="aspect-square" />

      <div className="space-y-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-slate-800">
            <Heart size={18} className="hover:text-rose-500" />
            <MessageCircle size={18} />
            <Send size={18} />
          </div>
          <Bookmark size={18} className="text-slate-800" />
        </div>

        <div className="text-xs font-semibold text-slate-800">1,245 likes</div>

        <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">
          <span className="font-semibold">{username}</span> <span>{formatHashtags(caption)}</span>
        </div>

        <div className="text-[11px] text-slate-400">Just now</div>
      </div>
    </div>
  );
}

function ThreadsPreviewCard({ caption, imageUrl }: { caption: string; imageUrl: string }) {
  const username = 'your_threads';
  const urls = extractUrls(caption);
  const captionWithoutUrls = stripUrls(caption);
  const domain = urls.length ? extractDomain(urls[0]) : '';

  return (
    <div className="max-w-[560px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 shadow-sm">
      <div className="flex items-start gap-3 px-4 pt-4">
        <div className="mt-0.5 h-10 w-10 overflow-hidden rounded-full bg-white/10 flex items-center justify-center">
          <PlatformLogo platform="threads" size={30} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{username}</span>
            <span className="text-xs text-slate-400">AI Threads</span>
            <span className="text-xs text-slate-500">· 8h</span>
          </div>

          <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-100">
            {formatHashtags(captionWithoutUrls, 'font-bold text-sky-300')}
          </div>

          {domain ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
              <span className="font-semibold text-slate-200">{domain}</span>
              <ChevronDown size={14} className="text-slate-400" />
            </div>
          ) : null}

          {imageUrl ? (
            <div className="mt-4">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
                <span className="inline-flex items-center gap-1">
                  <Play size={12} /> 16:9
                </span>
                <span>· ContentFlow · 15 sec</span>
                <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-300">1/2</span>
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
                <PreviewImage url={imageUrl} aspectClass="aspect-video" />
                <div className="absolute bottom-3 right-3 rounded-full bg-black/50 p-2 text-white">
                  <VolumeX size={16} />
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-6 text-slate-300 pb-4">
            <button type="button" className="inline-flex items-center gap-2 hover:text-white">
              <Heart size={18} /> <span className="text-xs">27</span>
            </button>
            <button type="button" className="inline-flex items-center gap-2 hover:text-white">
              <MessageCircle size={18} /> <span className="text-xs">6</span>
            </button>
            <button type="button" className="inline-flex items-center gap-2 hover:text-white">
              <Repeat2 size={18} /> <span className="text-xs">2</span>
            </button>
            <button type="button" className="inline-flex items-center gap-2 hover:text-white">
              <Send size={18} /> <span className="text-xs">5</span>
            </button>
          </div>
        </div>
        <button type="button" className="text-slate-500 hover:text-slate-300" aria-label="More">
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}

function PinterestPreviewCard({ caption, imageUrl, title }: { caption: string; imageUrl: string; title: string }) {
  const urls = extractUrls(caption);
  const domain = urls.length ? extractDomain(urls[0]) : '';
  const withoutUrls = stripUrls(caption);
  const hashtags = extractHashtags(withoutUrls);
  const description = stripHashtags(withoutUrls);

  return (
    <div className="max-w-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-slate-200 p-4">
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <PreviewImage url={imageUrl} aspectClass="aspect-[16/10]" />
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        <div className="text-lg font-bold text-slate-950 leading-snug">{title || 'Pin title'}</div>

        {description ? (
          <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap break-words">{description}</div>
        ) : null}

        {hashtags.length ? (
          <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">
            {hashtags.map((tag) => (
              <span key={tag} className="mr-2 font-bold text-blue-700">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {domain ? (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs font-semibold text-slate-600">{domain}</div>
            <button
              type="button"
              className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm border border-slate-200"
            >
              Visit
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TikTokPreviewCard({ caption, imageUrl }: { caption: string; imageUrl: string }) {
  const username = '@yourtiktok';

  return (
    <div className="max-w-[360px] overflow-hidden rounded-2xl border border-slate-900 bg-black shadow-sm">
      <div className="relative">
        <PreviewImage url={imageUrl} aspectClass="aspect-[9/16]" />

        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/10 to-black/70" />

        <div className="absolute left-3 top-3 flex items-center gap-2 text-white">
          <div className="rounded-full bg-black/50 p-2">
            <VolumeX size={16} />
          </div>
        </div>

        <div className="absolute right-3 top-3 text-white">
          <button type="button" className="rounded-full bg-black/40 p-2" aria-label="More">
            <MoreHorizontal size={18} />
          </button>
        </div>

        <div className="absolute right-3 bottom-24 flex flex-col items-center gap-4 text-white">
          <div className="h-11 w-11 rounded-full bg-white/10 flex items-center justify-center overflow-hidden border border-white/10">
            <PlatformLogo platform="tiktok" size={30} />
          </div>
          <div className="flex flex-col items-center gap-1">
            <Heart size={26} />
            <span className="text-[11px] font-semibold">53K</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <MessageCircle size={26} />
            <span className="text-[11px] font-semibold">1612</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Bookmark size={26} />
            <span className="text-[11px] font-semibold">53.8K</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Share2 size={26} />
            <span className="text-[11px] font-semibold">10.6K</span>
          </div>
        </div>

        <div className="absolute left-4 right-16 bottom-5 text-white">
          <div className="text-sm font-semibold">{username}</div>
          <div className="mt-1 text-xs leading-relaxed whitespace-pre-wrap break-words text-white/90">
            {formatHashtags(caption, 'font-bold text-sky-300')}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-white/80">
            <Music2 size={14} />
            <span className="truncate">Original sound · ContentFlow</span>
          </div>
        </div>

        <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/20">
          <div className="h-1 w-1/3 bg-white" />
        </div>
      </div>
    </div>
  );
}

function FacebookPreviewCard({ caption, imageUrl, title }: { caption: string; imageUrl: string; title: string }) {
  const name = 'Your Page';
  const urls = extractUrls(caption);
  const domain = urls.length ? extractDomain(urls[0]) : '';
  const captionWithoutUrls = stripUrls(caption);
  const showPlay = Boolean(imageUrl);

  const actionLabels = [
    { label: 'Like', icon: ThumbsUp },
    { label: 'Comment', icon: MessageCircle },
    { label: 'Share', icon: Share2 },
  ];

  return (
    <div className="max-w-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="h-10 w-10 overflow-hidden rounded-full bg-slate-100 flex items-center justify-center">
          <PlatformLogo platform="facebook" size={30} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
          <div className="text-xs text-slate-500">Sponsored · Public</div>
        </div>
        <button type="button" className="text-slate-400 hover:text-slate-600" aria-label="More">
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div className="px-4 pb-3 text-sm text-slate-800 whitespace-pre-wrap break-words">
        {formatHashtags(captionWithoutUrls)}
      </div>

      <div className="bg-gradient-to-r from-emerald-500/20 via-sky-500/20 to-indigo-500/20 p-3">
        <div className="relative overflow-hidden rounded-xl bg-black/5">
          <PreviewImage url={imageUrl} aspectClass="aspect-[16/9]" />
          {showPlay ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-white/80 p-3 shadow-sm">
                <Play size={18} className="text-slate-900" />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {domain ? (
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{domain}</div>
              <div className="truncate text-sm font-semibold text-slate-900">{title || 'Open link'}</div>
            </div>
            <button
              type="button"
              className="whitespace-nowrap rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200"
            >
              Learn more
            </button>
          </div>
        </div>
      ) : null}

      <div className="border-t border-slate-100 px-2 py-2">
        <div className="flex items-center justify-around text-xs font-semibold text-slate-600">
          {actionLabels.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-slate-50"
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LinkedInPreviewCard({ caption, imageUrl }: { caption: string; imageUrl: string }) {
  const actionLabels = [
    { label: 'Like', icon: ThumbsUp },
    { label: 'Comment', icon: MessageCircle },
    { label: 'Repost', icon: Repeat2 },
    { label: 'Send', icon: Send },
  ];

  return (
    <div className="max-w-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="h-10 w-10 overflow-hidden rounded-full bg-slate-100 flex items-center justify-center">
          <PlatformLogo platform="linkedin" size={30} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">Your Company</div>
          <div className="text-xs text-slate-500">1h · Public</div>
        </div>
        <button type="button" className="text-slate-400 hover:text-slate-600" aria-label="More">
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div className="px-4 pb-3 text-sm text-slate-800 whitespace-pre-wrap break-words">
        {formatHashtags(caption)}
      </div>

      {imageUrl ? <PreviewImage url={imageUrl} aspectClass="aspect-[16/9]" /> : null}

      <div className="border-t border-slate-100 px-2 py-2">
        <div className="flex items-center justify-around text-xs font-semibold text-slate-600">
          {actionLabels.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-slate-50"
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TwitterPreviewCard({ caption, imageUrl }: { caption: string; imageUrl: string }) {
  return (
    <div className="max-w-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex gap-3 px-4 py-3">
        <div className="mt-0.5 h-9 w-9 overflow-hidden rounded-full bg-slate-100 flex items-center justify-center">
          <PlatformLogo platform="twitter" size={30} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">Your Name</span>
            <span className="text-sm text-slate-500">@yourhandle · 1m</span>
          </div>
          <div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap break-words">{formatHashtags(caption)}</div>

          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            <PreviewImage url={imageUrl} aspectClass="aspect-[16/9]" />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <MessageCircle size={14} /> 12
            </span>
            <span className="inline-flex items-center gap-1">
              <Repeat2 size={14} /> 4
            </span>
            <span className="inline-flex items-center gap-1">
              <Heart size={14} /> 38
            </span>
            <span className="inline-flex items-center gap-1">
              <Share2 size={14} /> 1
            </span>
          </div>
        </div>
        <button type="button" className="text-slate-400 hover:text-slate-600" aria-label="More">
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}

function SocialPreviewCard({
  platform,
  caption,
  imageUrl,
  postTitle,
}: {
  platform: string;
  caption: string;
  imageUrl: string;
  postTitle: string;
}) {
  const normalized = String(platform || '').trim().toLowerCase();
  if (normalized === 'threads') return <ThreadsPreviewCard caption={caption} imageUrl={imageUrl} />;
  if (normalized === 'pinterest') return <PinterestPreviewCard caption={caption} imageUrl={imageUrl} title={postTitle} />;
  if (normalized === 'tiktok') return <TikTokPreviewCard caption={caption} imageUrl={imageUrl} />;
  if (normalized === 'facebook') return <FacebookPreviewCard caption={caption} imageUrl={imageUrl} title={postTitle} />;
  if (normalized === 'linkedin') return <LinkedInPreviewCard caption={caption} imageUrl={imageUrl} />;
  if (normalized === 'instagram') return <InstagramPreviewCard caption={caption} imageUrl={imageUrl} />;
  if (normalized === 'twitter' || normalized === 'x') return <TwitterPreviewCard caption={caption} imageUrl={imageUrl} />;
  return <FacebookPreviewCard caption={caption} imageUrl={imageUrl} title={postTitle} />;
}

export default function SocialTemplatePreview({
  platform,
  settings,
}: {
  platform: string;
  settings: SocialTemplateSettings;
}) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [selectedPostId, setSelectedPostId] = useState<string>('');
  const [preview, setPreview] = useState<SocialTemplatePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewPosts = useMemo(() => posts.slice(0, 10), [posts]);
  const network = useMemo(() => getNetworkConfig(platform), [platform]);
  const selectedPostTitle = useMemo(
    () => posts.find((post) => post.id === selectedPostId)?.title || '',
    [posts, selectedPostId],
  );

  useEffect(() => {
    let canceled = false;
    setLoadingPosts(true);
    setError(null);

    blogService
      .listPosts()
      .then((result) => {
        if (canceled) return;
        setPosts(result || []);
      })
      .catch((e: any) => {
        if (canceled) return;
        setError(e?.message || 'Failed to load posts');
      })
      .finally(() => {
        if (canceled) return;
        setLoadingPosts(false);
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPostId && previewPosts.length > 0) {
      setSelectedPostId(previewPosts[0].id);
    }
  }, [previewPosts, selectedPostId]);

  const runPreview = async () => {
    if (!selectedPostId) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const result = await socialTemplateService.previewTemplate(platform, selectedPostId, settings);
      setPreview(result);
    } catch (e: any) {
      setError(e?.message || 'Failed to generate preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {loadingPosts ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Loading posts...
        </div>
      ) : null}

      {!loadingPosts && previewPosts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          No posts found yet. Create a post to preview your template.
        </div>
      ) : null}

      {!loadingPosts && previewPosts.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={selectedPostId}
            onChange={(e) => setSelectedPostId(e.target.value)}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          >
            {previewPosts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.title || post.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={runPreview}
            disabled={previewLoading || !selectedPostId}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {previewLoading ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" /> Generating...
              </>
            ) : (
              'Preview'
            )}
          </button>
        </div>
      ) : null}

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}

      {preview ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {preview.warning ? (
                <AlertCircle size={16} className="text-red-500" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald-500" />
              )}
              <span>
                {preview.characterCount} / {preview.limit} characters
              </span>
              {network ? <span className="text-xs font-semibold text-slate-400">• {network.label} preview</span> : null}
            </div>
            {preview.truncated ? (
              <div className="text-xs font-semibold text-red-600">Truncated from {preview.originalCharacterCount} characters</div>
            ) : null}
          </div>

          {preview.warning ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              {preview.warning}
            </div>
          ) : null}

          <SocialPreviewCard
            platform={platform}
            caption={preview.rendered}
            imageUrl={preview.featuredImage || ''}
            postTitle={selectedPostTitle}
          />
        </div>
      ) : null}
    </div>
  );
}

