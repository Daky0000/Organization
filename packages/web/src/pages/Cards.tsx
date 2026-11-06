import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Plus, Sparkles, Wand2,
  CheckCircle2, Loader2, RefreshCw, ChevronDown, Download, Edit3,
  AlertCircle, Layers, Trash2, Clock, Image, LayoutTemplate,
  Heart, Copy, Play, X, Video, Maximize2,
  RotateCcw, Lock, Mic,
} from 'lucide-react';
import { UserDesign, designService } from '../services/designService';
import { getApiBaseUrl } from '../utils/apiBase';

// ── Discover types & constants ────────────────────────────────────────────────

type ModelFilter = 'all' | 'gpt' | 'gemini';
type SortMode    = 'featured' | 'newest' | 'popular';
type UseMode     = 'prompt' | 'ref';

const MODEL_TABS: { id: ModelFilter; label: string; badge?: string }[] = [
  { id: 'all',    label: 'All' },
  { id: 'gpt',    label: 'GPT Image' },
  { id: 'gemini', label: 'Gemini' },
];

// One item in the Discover masonry — either media pulled from an MCP server
// (MeiGen gallery) or a locally published admin template.
type DiscoverItem = {
  key: string;
  source: 'mcp' | 'template';
  id: string;
  name: string;
  prompt: string;
  imageUrl: string | null;
  model: string | null;
  likeCount: number;
  liked: boolean;
  createdAt: string;
};

const ASPECT_RATIOS = ['1:1', '3:4', '4:5', '2:3', '9:16', '4:3', '5:4', '3:2', '16:9', '21:9', '9:21'] as const;

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tok() { return localStorage.getItem('auth_token') ?? ''; }

// ── Credit badge ──────────────────────────────────────────────────────────────

function CreditBadge({ refreshKey = 0 }: { refreshKey?: number }) {
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/credits/balance`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.success) setCredits(d.credits); })
      .catch(() => {});
  }, [refreshKey]);

  if (credits === null) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-[#2563EB]">
      <span className="text-sm">✦</span>
      <span>{credits} credits</span>
    </div>
  );
}

// ── Inspiration card ──────────────────────────────────────────────────────────

// ── Model definitions ─────────────────────────────────────────────────────────

type GenMode = 'image' | 'video' | 'audio';

const TTS_MODELS: { id: string; label: string; creditCost: number; maxChars: number; desc: string; isMagnific?: boolean; audioType?: 'music' | 'sfx' | 'tts' }[] = [
  { id: 'magnific-music',  label: 'Magnific Music',     creditCost: 6, maxChars: 1000, desc: 'Royalty-free music & instrumentals', isMagnific: true, audioType: 'music' },
  { id: 'magnific-sfx',    label: 'Magnific Sound FX',  creditCost: 3, maxChars: 1000, desc: 'Cinematic SFX, foley & ambient loops', isMagnific: true, audioType: 'sfx' },
  { id: 'magnific-tts',    label: 'Magnific Voiceover', creditCost: 3, maxChars: 4096, desc: 'Speech synthesis (chains w/ Lip Sync)', isMagnific: true, audioType: 'tts' },
  { id: 'tts-1',           label: 'TTS-1',              creditCost: 2, maxChars: 4096, desc: 'Fast, low-latency'      },
  { id: 'gpt-4o-mini-tts', label: 'GPT-4o Mini TTS',    creditCost: 3, maxChars: 4096, desc: 'Natural, expressive'    },
  { id: 'tts-1-hd',        label: 'TTS-1 HD',           creditCost: 4, maxChars: 4096, desc: 'High-definition audio'  },
];
const TTS_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'] as const;

interface AIModel {
  id: string;
  label: string;
  desc: string;
  creditCost: number;
  maxChars: number;
  badge?: string;
}

type ImageProvider = 'magnific' | 'freepik' | 'kling' | 'google' | 'openai';

const IMAGE_MODELS_BY_PROVIDER: Record<ImageProvider, AIModel[]> = {
  magnific: [
    { id: 'magnific-one',          label: 'Magnific One',      desc: 'Art-directed 4K & 16-tile contact sheets', creditCost: 6, maxChars: 4000, badge: 'FLAGSHIP' },
    { id: 'nano-banana-pro',       label: 'Nano Banana Pro',   desc: 'Product text, sketches & surgical edits',  creditCost: 4, maxChars: 2500, badge: 'PRO TEXT' },
    { id: 'nano-banana-2',         label: 'Nano Banana 2',     desc: '4K Character Sheets & surface mockups',    creditCost: 4, maxChars: 2500, badge: '4K MOCKUP' },
    { id: 'mystic',                label: 'Mystic',            desc: "Magnific's ultra-photorealistic model",   creditCost: 8, maxChars: 1000, badge: 'Popular' },
    { id: 'flux-kontext-pro',      label: 'Flux Kontext Pro',  desc: 'Context-aware — best for edits & refs',   creditCost: 5, maxChars: 2000, badge: 'Popular' },
    { id: 'flux-2-pro',            label: 'Flux 2 Pro',        desc: 'High quality text-to-image',              creditCost: 5, maxChars: 1500 },
    { id: 'seedream-v5-lite',      label: 'Seedream 5 Lite',   desc: 'New — high coherence & detail',           creditCost: 4, maxChars: 500,  badge: 'NEW' },
    { id: 'seedream-v4-5',         label: 'Seedream 4.5',      desc: 'Stable Seedream with editing',            creditCost: 4, maxChars: 500  },
    { id: 'flux-pro-v1-1',         label: 'Flux Pro v1.1',     desc: 'Proven pro — sharp + accurate',           creditCost: 5, maxChars: 1500 },
    { id: 'flux-dev',              label: 'Flux Dev',          desc: 'Quality Flux development model',          creditCost: 4, maxChars: 1500 },
    { id: 'flux-2-turbo',          label: 'Flux 2 Turbo',      desc: 'Fastest — great for drafts',             creditCost: 3, maxChars: 1000 },
    { id: 'flux-2-klein',          label: 'Flux 2 Klein',      desc: 'Fast with multi-ref support',             creditCost: 3, maxChars: 1000 },
    { id: 'hyperflux',             label: 'Hyperflux',         desc: 'Ultra-fast Flux variant',                 creditCost: 3, maxChars: 1000 },
    { id: 'gemini-flash',          label: 'Gemini 2.5 Flash',  desc: 'Google Gemini — vivid & fast',            creditCost: 6, maxChars: 2000, badge: 'NEW' },
    { id: 'nano-banana-pro-flash', label: 'Nano Banana Flash', desc: 'Google Nano — ultra-fast',                creditCost: 3, maxChars: 1000 },
    { id: 'z-image',               label: 'Z-Image Turbo',     desc: 'Budget-friendly fast generation',         creditCost: 2, maxChars: 500  },
  ],
  freepik: [
    { id: 'freepik-mystic', label: 'Freepik Mystic', desc: 'High-quality creative image generation', creditCost: 5, maxChars: 1000 },
  ],
  kling: [
    { id: 'kling-v1-5', label: 'Kling v1.5', desc: 'Kling image generation — detailed', creditCost: 5, maxChars: 2500 },
    { id: 'kling-v1',   label: 'Kling v1',   desc: 'Kling image generation — fast',     creditCost: 4, maxChars: 2500 },
  ],
  google: [
    { id: 'google-imagen-4-fast',   label: 'Imagen 4 Fast',      desc: 'Fast photorealistic generation',  creditCost: 4,  maxChars: 1024 },
    { id: 'google-imagen-4',        label: 'Imagen 4',           desc: 'High-quality photorealistic',      creditCost: 6,  maxChars: 1024 },
    { id: 'google-imagen-4-ultra',  label: 'Imagen 4 Ultra',     desc: 'Maximum quality, finest detail',   creditCost: 10, maxChars: 1024 },
    { id: 'google-gemini-flash',    label: 'Gemini Flash Image', desc: 'Fast multimodal image generation', creditCost: 3,  maxChars: 2000 },
    { id: 'google-gemini-nano-2',   label: 'Nano Banana 2',      desc: 'Creative image generation',        creditCost: 5,  maxChars: 2000, badge: 'NEW' },
    { id: 'google-gemini-nano-pro', label: 'Nano Banana Pro',    desc: 'Pro-grade creative generation',    creditCost: 8,  maxChars: 2000 },
  ],
  openai: [
    // Mirrors OPENAI_IMAGE_MODELS in packages/api/src/server/openaiRoutes.ts (checked 2026-10-29).
    { id: 'gpt-image-2.5-flare',    label: 'GPT Image 2.5 Flare',    desc: 'Fast, high-quality everyday generation', creditCost: 8,  maxChars: 4000, badge: 'NEW' },
    { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', desc: 'Most capable; best for text in images',  creditCost: 12, maxChars: 4000 },
  ],
};

const KLING_IMAGE_MODEL_IDS  = new Set(IMAGE_MODELS_BY_PROVIDER.kling.map((m) => m.id));
const GOOGLE_IMAGE_MODEL_IDS = new Set(IMAGE_MODELS_BY_PROVIDER.google.map((m) => m.id));
const OPENAI_IMAGE_MODEL_IDS = new Set(IMAGE_MODELS_BY_PROVIDER.openai.map((m) => m.id));

// Magnific is the primary image engine alongside GPT and Gemini.
const ENABLED_IMAGE_PROVIDERS: { id: ImageProvider; label: string }[] = [
  { id: 'magnific', label: 'Magnific' },
  { id: 'openai',   label: 'GPT' },
  { id: 'google',   label: 'Gemini' },
  { id: 'kling',    label: 'Kling' },
];

type VideoProvider = 'magnific' | 'kling' | 'google';

const VIDEO_MODELS_BY_PROVIDER: Record<VideoProvider, AIModel[]> = {
  magnific: [
    { id: 'seedance-2-5',             label: 'Seedance 2.5',      desc: 'Up to 30s, 50 refs, multi-shot & 3D motion', creditCost: 32, maxChars: 2500, badge: 'FLAGSHIP' },
    { id: 'kling-3-0-omni',           label: 'Kling 3.0 Omni',    desc: 'Multi-ref dialogue lip-sync & product text', creditCost: 35, maxChars: 2500, badge: 'OMNI' },
    { id: 'kling-3-0',                label: 'Kling 3.0',         desc: 'Single-shot & 6-cut Multi-Shot (≤15s)',      creditCost: 35, maxChars: 2500, badge: 'MULTI-SHOT' },
    { id: 'kling-motion',             label: 'Kling Motion 2.6',  desc: 'Biomechanics transfer (camera-only prompt)', creditCost: 28, maxChars: 1500, badge: 'MOTION' },
    { id: 'kling-v2-6-pro',           label: 'Kling 2.6 Pro',     desc: 'Cinematic T2V/I2V with native audio',        creditCost: 30, maxChars: 2500 },
    { id: 'ltx-2-pro',                label: 'LTX 2 Pro (4K)',    desc: 'Up to 4K 50fps with synchronized audio',     creditCost: 28, maxChars: 2000, badge: '4K' },
    { id: 'omni-human-1-5',           label: 'OmniHuman 1.5',     desc: 'Lip-sync talking avatar from portrait',      creditCost: 30, maxChars: 2000, badge: 'LIP SYNC' },
    { id: 'wan-2-6-1080p',            label: 'WAN 2.6 (1080p)',   desc: 'Multi-shot narrative continuity + audio',    creditCost: 25, maxChars: 1500 },
    { id: 'minimax-hailuo-2-3-1080p', label: 'Hailuo 2.3 (1080p)',desc: 'Camera commands [Pan left], [Zoom in]',      creditCost: 25, maxChars: 2000 },
    { id: 'runway-gen4-turbo',        label: 'Runway Gen-4 Turbo',desc: 'Expressive character & scene motion',        creditCost: 25, maxChars: 1500 },
    { id: 'seedance-pro-1080p',       label: 'Seedance Pro 1080p',desc: 'Fluid dance & dynamic motion',               creditCost: 25, maxChars: 1500 },
    { id: 'wan-2-7-t2v',              label: 'WAN 2.7',           desc: 'Text-to-video, cinematic quality',           creditCost: 25, maxChars: 1000 },
  ],
  kling: [
    { id: 'kling-v2.5-turbo', label: 'Kling v2.5 Turbo', desc: 'Fast, high-quality video',  creditCost: 20, maxChars: 2500 },
    { id: 'kling-v2.6-pro',   label: 'Kling v2.6 Pro',   desc: 'Latest flagship model',      creditCost: 35, maxChars: 2500 },
    { id: 'kling-v1.6-pro',   label: 'Kling v1.6 Pro',   desc: 'Stable quality video',       creditCost: 25, maxChars: 2500 },
  ],
  google: [
    { id: 'google-veo-3-fast', label: 'Veo 3.1 Fast', desc: 'Fast cinematic video generation', creditCost: 25, maxChars: 2000 },
    { id: 'google-veo-3',      label: 'Veo 3.1',      desc: "Google's flagship video model",   creditCost: 40, maxChars: 2000 },
  ],
};

const KLING_MODEL_IDS  = new Set(VIDEO_MODELS_BY_PROVIDER.kling.map((m) => m.id));
const GOOGLE_VIDEO_MODEL_IDS = new Set(VIDEO_MODELS_BY_PROVIDER.google.map((m) => m.id));

// Which video models support last-frame (tail) attachment
const KLING_LAST_FRAME_MODELS = new Set(['seedance-2-5', 'kling-3-0', 'kling-3-pro', 'kling-v2.6-pro', 'kling-v1.6-pro', 'kling-v2-6-pro']);

// ── AI Studio tab ─────────────────────────────────────────────────────────────

function AIStudio({ onDesignSaved, onCreditUsed }: { onDesignSaved: (d: UserDesign) => void; onCreditUsed?: () => void }) {
  const [genMode, setGenMode]                   = useState<GenMode>('image');
  const [imageProvider, setImageProvider] = useState<ImageProvider>('magnific');
  const [selectedImageModel, setSelectedImageModel] = useState<AIModel>(() => IMAGE_MODELS_BY_PROVIDER.magnific[0]);
  const [videoProvider, setVideoProvider] = useState<VideoProvider>('magnific');
  const [selectedVideoModel, setSelectedVideoModel] = useState<AIModel>(VIDEO_MODELS_BY_PROVIDER.magnific[0]);

  // Image generation state
  const [prompt, setPrompt]         = useState('');
  const [imageUrl, setImageUrl]     = useState<string | null>(null);
  const [designId, setDesignId]     = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  // Video generation state
  const [videoPrompt, setVideoPrompt]       = useState('');
  const [videoUrl, setVideoUrl]             = useState<string | null>(null);
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [videoError, setVideoError]         = useState<string | null>(null);

  // Video frame attachments
  const [firstFrame, setFirstFrame]   = useState<string | null>(null);
  const [lastFrame, setLastFrame]     = useState<string | null>(null);
  const firstFrameRef = useRef<HTMLInputElement>(null);
  const lastFrameRef  = useRef<HTMLInputElement>(null);

  const supportsLastFrame = (videoProvider === 'kling' || videoProvider === 'magnific') && KLING_LAST_FRAME_MODELS.has(selectedVideoModel.id);

  // Audio (Magnific Music / SFX / Voiceover + OpenAI TTS) state
  const [selectedTTSModel, setSelectedTTSModel] = useState(TTS_MODELS[0]);
  const [ttsVoice, setTtsVoice]   = useState<typeof TTS_VOICES[number]>('nova');
  const [ttsPrompt, setTtsPrompt] = useState('');
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [generatingTTS, setGeneratingTTS] = useState(false);
  const [ttsError, setTtsError]   = useState<string | null>(null);

  const readFileAsDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const generateTTS = async () => {
    if (!ttsPrompt.trim()) return;
    setGeneratingTTS(true);
    setTtsAudioUrl(null);
    setTtsError(null);
    try {
      const isMagAudio = Boolean(selectedTTSModel.isMagnific);
      const endpoint = isMagAudio ? '/api/magnific/audio' : '/api/openai/tts';
      const payload = isMagAudio
        ? { type: selectedTTSModel.audioType ?? 'music', prompt: ttsPrompt.trim(), text: ttsPrompt.trim(), voice: ttsVoice }
        : { text: ttsPrompt.trim(), model: selectedTTSModel.id, voice: ttsVoice };
      const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Audio generation failed');
      setTtsAudioUrl(d.audio_url ?? d.url ?? null);
      onCreditUsed?.();
    } catch (e: any) {
      setTtsError(e.message ?? 'Audio generation failed');
    } finally {
      setGeneratingTTS(false);
    }
  };

  const generateImage = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setImageUrl(null);
    setDesignId(null);
    setErrorMsg(null);
    try {
      const isKlingImage  = KLING_IMAGE_MODEL_IDS.has(selectedImageModel.id);
      const isGoogleImage = GOOGLE_IMAGE_MODEL_IDS.has(selectedImageModel.id);
      const isOpenAIImage = OPENAI_IMAGE_MODEL_IDS.has(selectedImageModel.id);
      const imageEndpoint = isKlingImage  ? '/api/kling/generate-image'
                          : isGoogleImage ? '/api/google/generate-image'
                          : isOpenAIImage ? '/api/openai/generate-image'
                          : '/api/nova/generate-image';
      const res = await fetch(`${getApiBaseUrl()}${imageEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ prompt: prompt.trim(), model: selectedImageModel.id, save: true }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Generation failed');
      setImageUrl(d.url ?? null);
      setDesignId(d.design_id ?? null);
      onCreditUsed?.();
      if (d.design_id) {
        // Trigger history refresh — pass a minimal stub so the tab knows to reload
        onDesignSaved({ id: d.design_id } as UserDesign);
      }
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const generateVideo = async () => {
    if (!videoPrompt.trim()) return;
    setGeneratingVideo(true);
    setVideoUrl(null);
    setVideoError(null);
    try {
      const isKling  = KLING_MODEL_IDS.has(selectedVideoModel.id);
      const isGoogle = GOOGLE_VIDEO_MODEL_IDS.has(selectedVideoModel.id);
      const isLipSync = selectedVideoModel.id === 'omni-human-1-5';
      const endpoint = isLipSync ? '/api/magnific/lip-sync'
                     : isKling   ? '/api/kling/generate-video'
                     : isGoogle  ? '/api/google/generate-video'
                     : '/api/nova/generate-video';
      const body: Record<string, any> = isLipSync
        ? { image_url: firstFrame, text: videoPrompt.trim(), prompt: videoPrompt.trim(), resolution: '1080p' }
        : { prompt: videoPrompt.trim(), model: selectedVideoModel.id };
      if (!isLipSync && firstFrame) body.image_url = firstFrame;
      if (!isLipSync && lastFrame && supportsLastFrame) body.tail_image_url = lastFrame;
      const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Video generation failed');
      setVideoUrl(d.url ?? null);
      onCreditUsed?.();
    } catch (e: any) {
      setVideoError(e.message ?? 'Video generation failed');
    } finally {
      setGeneratingVideo(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Mode + model picker */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2563EB]/10">
            <Wand2 size={20} className="text-[#2563EB]" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900">AI Design Studio</h2>
            <p className="text-sm text-slate-500">Write a prompt — your image is generated exactly as described.</p>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit mb-5">
          {([
            { id: 'image' as GenMode, label: 'Image', icon: <Image size={13} /> },
            { id: 'video' as GenMode, label: 'Video', icon: <Video size={13} /> },
            { id: 'audio' as GenMode, label: 'Audio', icon: <Mic size={13} /> },
          ]).map((m) => (
            <button key={m.id} type="button" onClick={() => setGenMode(m.id)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${genMode === m.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>

        {/* Model picker */}
        <div className="mb-5">
          {genMode === 'image' ? (
            <>
              {/* Provider tabs */}
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Provider</label>
              <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit mb-4">
                {ENABLED_IMAGE_PROVIDERS.map((p) => (
                  <button key={p.id} type="button"
                    onClick={() => {
                      setImageProvider(p.id);
                      setSelectedImageModel(IMAGE_MODELS_BY_PROVIDER[p.id][0]);
                    }}
                    className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${imageProvider === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              {/* Models for selected provider */}
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Model</label>
              <div className="flex flex-wrap gap-2">
                {IMAGE_MODELS_BY_PROVIDER[imageProvider].map((m) => (
                  <button key={m.id} type="button" onClick={() => setSelectedImageModel(m)}
                    className={`relative flex flex-col rounded-xl border px-3 py-2 text-left transition min-w-[130px] ${
                      selectedImageModel.id === m.id ? 'border-[#2563EB] bg-indigo-50 text-[#2563EB]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}>
                    {m.badge && <span className="absolute -top-2 -right-2 rounded-full bg-[#2563EB] px-1.5 py-0.5 text-[9px] font-bold text-white">{m.badge}</span>}
                    <span className="text-xs font-bold">{m.label}</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">{m.desc}</span>
                    <span className="mt-1 text-[10px] font-bold text-[#2563EB]">✦{m.creditCost} credits</span>
                  </button>
                ))}
              </div>
            </>
          ) : genMode === 'video' ? (
            <>
              {/* Provider tabs */}
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Provider</label>
              <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit mb-4">
                {([
                  { id: 'magnific' as VideoProvider, label: 'Magnific'  },
                  { id: 'kling'    as VideoProvider, label: 'Kling AI'  },
                  { id: 'google'   as VideoProvider, label: 'Google AI' },
                ] as const).map((p) => (
                  <button key={p.id} type="button"
                    onClick={() => {
                      setVideoProvider(p.id);
                      setSelectedVideoModel(VIDEO_MODELS_BY_PROVIDER[p.id][0]);
                      setLastFrame(null);
                    }}
                    className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${videoProvider === p.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              {/* Models for selected provider */}
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Model</label>
              <div className="flex flex-wrap gap-2">
                {VIDEO_MODELS_BY_PROVIDER[videoProvider].map((m) => (
                  <button key={m.id} type="button" onClick={() => {
                    setSelectedVideoModel(m);
                    if (!KLING_LAST_FRAME_MODELS.has(m.id)) setLastFrame(null);
                  }}
                    className={`relative flex flex-col rounded-xl border px-3 py-2 text-left transition min-w-[130px] ${
                      selectedVideoModel.id === m.id ? 'border-[#2563EB] bg-indigo-50 text-[#2563EB]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}>
                    {m.badge && <span className="absolute -top-2 -right-2 rounded-full bg-[#2563EB] px-1.5 py-0.5 text-[9px] font-bold text-white">{m.badge}</span>}
                    <span className="text-xs font-bold">{m.label}</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">{m.desc}</span>
                    <span className="mt-1 text-[10px] font-bold text-[#2563EB]">✦{m.creditCost} credits</span>
                  </button>
                ))}
              </div>
            </>
          ) : genMode === 'audio' ? (
            <>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Model</label>
              <div className="flex flex-wrap gap-2 mb-5">
                {TTS_MODELS.map((m) => (
                  <button key={m.id} type="button" onClick={() => setSelectedTTSModel(m)}
                    className={`flex flex-col rounded-xl border px-3 py-2 text-left transition min-w-[130px] ${
                      selectedTTSModel.id === m.id ? 'border-[#2563EB] bg-indigo-50 text-[#2563EB]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}>
                    <span className="text-xs font-bold">{m.label}</span>
                    <span className="text-[10px] text-slate-400 mt-0.5">{m.desc}</span>
                    <span className="mt-1 text-[10px] font-bold text-[#2563EB]">✦{m.creditCost} credits</span>
                  </button>
                ))}
              </div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Voice</label>
              <div className="flex flex-wrap gap-2">
                {TTS_VOICES.map((v) => (
                  <button key={v} type="button" onClick={() => setTtsVoice(v)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
                      ttsVoice === v ? 'border-[#2563EB] bg-indigo-50 text-[#2563EB]' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}>
                    {v}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {/* Image form */}
        {genMode === 'image' ? (
          <div className="space-y-3">
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !generating) generateImage(); }}
                rows={4}
                placeholder="Describe exactly what you want to generate…"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition"
              />
              <span className={`absolute bottom-2.5 right-3 text-[10px] font-medium ${prompt.length > selectedImageModel.maxChars * 0.9 ? 'text-rose-500' : 'text-slate-400'}`}>
                {prompt.length}/{selectedImageModel.maxChars}
              </span>
            </div>
            <button type="button" disabled={!prompt.trim() || generating} onClick={generateImage}
              className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-40 transition active:scale-[0.98]">
              {generating ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><Sparkles size={15} /> Generate ✦{selectedImageModel.creditCost}</>}
            </button>
            {errorMsg && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{errorMsg}</p>
              </div>
            )}
          </div>
        ) : genMode === 'video' ? (
          /* Video form */
          <div className="space-y-3">
            {/* Frame attachments — Magnific, Kling, and Google Veo */}
            {(videoProvider === 'magnific' || videoProvider === 'kling' || videoProvider === 'google') && (
              <div className="grid gap-2 sm:grid-cols-2">
                {/* First frame */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    {selectedVideoModel.id === 'omni-human-1-5' ? 'Portrait Image ' : 'First Frame '}
                    <span className="normal-case font-normal text-slate-400">
                      {selectedVideoModel.id === 'omni-human-1-5' ? '(required for lip-sync)' : '(optional)'}
                    </span>
                  </label>
                  <button type="button" onClick={() => firstFrameRef.current?.click()}
                    className="group relative flex w-full items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-left hover:border-[#2563EB] hover:bg-indigo-50 transition">
                    {firstFrame ? (
                      <>
                        <img src={firstFrame} alt="First frame" className="h-10 w-10 shrink-0 rounded-lg object-cover border border-slate-200" />
                        <span className="flex-1 text-xs font-semibold text-slate-700 truncate">First frame set</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setFirstFrame(null); }}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-rose-100 hover:text-rose-600 transition">
                          <X size={10} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
                          <Image size={14} />
                        </div>
                        <span className="text-xs text-slate-500">Upload first frame</span>
                      </>
                    )}
                  </button>
                  <input ref={firstFrameRef} type="file" accept="image/*" className="hidden"
                    onChange={async (e) => { const f = e.target.files?.[0]; if (f) setFirstFrame(await readFileAsDataURL(f)); e.target.value = ''; }} />
                </div>

                {/* Last frame — only for models that support it */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    Last Frame{' '}
                    {supportsLastFrame
                      ? <span className="normal-case font-normal text-slate-400">(optional)</span>
                      : <span className="normal-case font-normal text-slate-300">— not supported by this model</span>}
                  </label>
                  <button type="button" disabled={!supportsLastFrame} onClick={() => lastFrameRef.current?.click()}
                    className="group relative flex w-full items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-left hover:border-[#2563EB] hover:bg-indigo-50 transition disabled:opacity-40 disabled:cursor-not-allowed">
                    {lastFrame ? (
                      <>
                        <img src={lastFrame} alt="Last frame" className="h-10 w-10 shrink-0 rounded-lg object-cover border border-slate-200" />
                        <span className="flex-1 text-xs font-semibold text-slate-700 truncate">Last frame set</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setLastFrame(null); }}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-rose-100 hover:text-rose-600 transition">
                          <X size={10} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
                          <Image size={14} />
                        </div>
                        <span className="text-xs text-slate-500">Upload last frame</span>
                      </>
                    )}
                  </button>
                  <input ref={lastFrameRef} type="file" accept="image/*" className="hidden"
                    onChange={async (e) => { const f = e.target.files?.[0]; if (f) setLastFrame(await readFileAsDataURL(f)); e.target.value = ''; }} />
                </div>
              </div>
            )}

            <div className="relative">
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                rows={3}
                placeholder={firstFrame ? 'Describe what happens in the video…' : 'Describe your video… e.g. a slow-motion ocean wave at sunset with cinematic lighting'}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition"
              />
              <span className={`absolute bottom-2.5 right-3 text-[10px] font-medium ${videoPrompt.length > selectedVideoModel.maxChars * 0.9 ? 'text-rose-500' : 'text-slate-400'}`}>
                {videoPrompt.length}/{selectedVideoModel.maxChars}
              </span>
            </div>
            <button type="button" disabled={!videoPrompt.trim() || generatingVideo} onClick={generateVideo}
              className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-40 transition active:scale-[0.98]">
              {generatingVideo
                ? <><Loader2 size={14} className="animate-spin" /> Generating…</>
                : <><Play size={14} /> {firstFrame ? 'Animate Frame' : 'Generate Video'} ✦{selectedVideoModel.creditCost}</>}
            </button>
            {videoError && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{videoError}</p>
              </div>
            )}
          </div>
        ) : genMode === 'audio' ? (
          /* Audio / TTS form */
          <div className="space-y-3">
            <div className="relative">
              <textarea
                value={ttsPrompt}
                onChange={(e) => setTtsPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !generatingTTS) generateTTS(); }}
                rows={5}
                placeholder="Enter the text you want to convert to speech…"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition"
              />
              <span className={`absolute bottom-2.5 right-3 text-[10px] font-medium ${ttsPrompt.length > selectedTTSModel.maxChars * 0.9 ? 'text-rose-500' : 'text-slate-400'}`}>
                {ttsPrompt.length}/{selectedTTSModel.maxChars}
              </span>
            </div>
            <button type="button" disabled={!ttsPrompt.trim() || generatingTTS} onClick={generateTTS}
              className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-600 disabled:opacity-40 transition active:scale-[0.98]">
              {generatingTTS ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><Mic size={14} /> Generate Speech ✦{selectedTTSModel.creditCost}</>}
            </button>
            {ttsError && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{ttsError}</p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Generating overlay */}
      {generating && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 flex flex-col items-center gap-4">
          <div className="relative w-14 h-14">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-100" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#2563EB] animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles size={18} className="text-[#2563EB]" />
            </div>
          </div>
          <div className="text-center">
            <p className="font-black text-slate-900">Generating your image…</p>
            <p className="text-sm text-slate-400 mt-1 max-w-xs truncate">"{prompt}"</p>
          </div>
          <p className="text-xs text-slate-400">This may take 15–60 seconds depending on the model.</p>
        </div>
      )}

      {/* Result */}
      {imageUrl && !generating && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <img src={imageUrl} alt="Generated" className="w-full object-cover" />
          <div className="p-4 flex items-center gap-3">
            <a href={imageUrl} download target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
              <Download size={13} /> Download
            </a>
            {designId && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                <CheckCircle2 size={13} /> Saved to History
              </span>
            )}
            <button type="button" onClick={() => { setImageUrl(null); setDesignId(null); setErrorMsg(null); }}
              className="ml-auto flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
              <RefreshCw size={13} /> New Image
            </button>
          </div>
        </div>
      )}

      {/* Video result */}
      {videoUrl && !generatingVideo && (
        <div className="rounded-2xl overflow-hidden border border-slate-200 bg-white">
          <video src={videoUrl} controls className="w-full" />
          <div className="p-4 flex gap-2">
            <a href={videoUrl} download target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
              <Download size={12} /> Download
            </a>
          </div>
        </div>
      )}

      {/* Audio result */}
      {ttsAudioUrl && !generatingTTS && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Mic size={15} className="text-[#2563EB]" /> Generated Speech
            <span className="ml-auto text-xs font-normal text-slate-400 capitalize">{ttsVoice} · {selectedTTSModel.label}</span>
          </div>
          <audio controls src={ttsAudioUrl} className="w-full" />
          <div className="flex items-center gap-2">
            <a href={ttsAudioUrl} download="speech.mp3"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
              <Download size={13} /> Download MP3
            </a>
            <button type="button" onClick={() => { setTtsAudioUrl(null); setTtsError(null); }}
              className="ml-auto flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
              <RefreshCw size={13} /> New Audio
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Types ─────────────────────────────────────────────────────────────────────

interface CardTemplate {
  id: string;
  name: string;
  description: string;
  designData: object;
  coverImageUrl: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  view_count?: number;
  like_count?: number;
}

// ── Image preview modal ───────────────────────────────────────────────────────

// MeiGen-style detail view: image left, metadata panel right. No creator
// identity — model badge, save/like, copy prompt, expandable PROMPT section,
// "More like this" strip, and Use as Prompt / Use as Ref actions.
function ImagePreviewModal({
  item,
  onClose,
  onUseAsPrompt,
  onUseAsRef,
  onToggleLike,
  onOpenSimilar,
}: {
  item: DiscoverItem;
  onClose: () => void;
  onUseAsPrompt: () => void;
  onUseAsRef: () => void;
  onToggleLike: () => void;
  onOpenSimilar: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [similar, setSimilar] = useState<Array<{ id: string; image_url: string; thumb_url: string | null }>>([]);

  useEffect(() => {
    setSimilar([]);
    setPromptOpen(false);
    if (item.source === 'template') {
      fetch(`${getApiBaseUrl()}/api/card-templates/${item.id}/view`, {
        method: 'POST', headers: { Authorization: `Bearer ${tok()}` },
      }).catch(() => {});
    } else {
      fetch(`${getApiBaseUrl()}/api/mcp/media/${item.id}`, { headers: { Authorization: `Bearer ${tok()}` } })
        .then(r => r.json())
        .then(d => { if (d.success && Array.isArray(d.similar)) setSimilar(d.similar); })
        .catch(() => {});
    }
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const copyPrompt = () => {
    navigator.clipboard.writeText(item.prompt || '').then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const promptText = item.prompt || '';
  const promptTruncated = !promptOpen && promptText.length > 260;
  const shownPrompt = promptTruncated ? `${promptText.slice(0, 260)}…` : promptText;

  return (
    <div className="fixed inset-0 z-50 flex bg-black/85 backdrop-blur-xl" onClick={onClose}>

      {/* Top-right controls (over the image area) */}
      <div className="absolute top-4 z-20 flex items-center gap-2" style={{ right: 'calc(288px + 16px)' }}>
        {item.imageUrl && (
          <a href={item.imageUrl} download target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition">
            <Download size={13} />
          </a>
        )}
        <span className="flex items-center rounded-lg bg-white/10 px-2 py-1 text-[11px] text-white/60">esc</span>
        <button type="button" onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition">
          <X size={14} />
        </button>
      </div>

      {/* Left: image */}
      <div className="flex-1 flex items-center justify-center p-8 md:p-16" onClick={e => e.stopPropagation()}>
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.name}
            className="max-h-[85vh] max-w-full object-contain rounded-2xl shadow-2xl" />
        ) : (
          <div className="w-64 aspect-[3/4] rounded-2xl bg-slate-800 flex items-center justify-center text-white/20">
            <LayoutTemplate size={48} />
          </div>
        )}
      </div>

      {/* Right: info panel */}
      <div className="w-72 bg-white flex flex-col shrink-0 overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header: model badge + save */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
          <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
            {item.model || 'AI generated'}
          </span>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <button type="button" onClick={onToggleLike}
              className={`flex items-center gap-1 transition ${item.liked ? 'text-red-500' : 'hover:text-red-400'}`}>
              <Heart size={13} className={item.liked ? 'fill-red-500' : ''} />
              {item.likeCount.toLocaleString()}
            </button>
            <span className="text-[10px] text-slate-400">{timeAgo(item.createdAt)}</span>
          </div>
        </div>

        {/* Scrollable body: prompt + similar */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Prompt</p>
            {promptText ? (
              <>
                <p className="text-[12px] text-slate-700 leading-relaxed whitespace-pre-wrap">{shownPrompt}</p>
                {promptText.length > 260 && (
                  <button type="button" onClick={() => setPromptOpen(o => !o)}
                    className="mt-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">
                    {promptOpen ? 'Show less' : 'Show more'}
                  </button>
                )}
              </>
            ) : (
              <span className="text-[12px] text-slate-400 italic">No prompt available.</span>
            )}
          </div>

          {similar.length > 0 && (
            <div className="px-4 pb-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">More like this</p>
              <div className="grid grid-cols-3 gap-1.5">
                {similar.map(s => (
                  <button key={s.id} type="button" onClick={() => onOpenSimilar(s.id)}
                    className="overflow-hidden rounded-lg bg-slate-100 aspect-square">
                    <img src={s.thumb_url || s.image_url} alt="" loading="lazy" className="h-full w-full object-cover hover:scale-105 transition-transform" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Copy prompt */}
        <div className="flex items-center gap-1 px-3 py-2 border-t border-slate-100">
          <button type="button" onClick={copyPrompt}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 transition">
            {copied ? <CheckCircle2 size={11} className="text-emerald-500" /> : <Copy size={11} />}
            {copied ? 'Copied to clipboard' : 'Copy Prompt'}
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 px-4 py-3 border-t border-slate-100">
          <button type="button"
            onClick={() => { onUseAsPrompt(); onClose(); }}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-[11px] font-bold text-white hover:bg-slate-800 transition">
            <RotateCcw size={11} /> Use as Prompt
          </button>
          <button type="button"
            onClick={() => { onUseAsRef(); onClose(); }}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-[11px] font-bold text-white hover:bg-slate-800 transition">
            Use as Ref
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Discover card (masonry) ───────────────────────────────────────────────────

// MeiGen-style card: just the image; hover reveals Use Idea + like. No
// creator identity, no share/external buttons — by design.
function DiscoverCard({
  item,
  onPreview,
  onUseIdea,
  onToggleLike,
}: {
  item: DiscoverItem;
  onPreview: () => void;
  onUseIdea: (e: React.MouseEvent) => void;
  onToggleLike: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-xl bg-slate-900"
      onClick={onPreview}
    >
      {item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt={item.name}
          loading="lazy"
          className="w-full h-auto block bg-[#efe9df] transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="aspect-[4/5] flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900">
          <LayoutTemplate size={36} className="text-white/20" />
        </div>
      )}

      {/* Bottom overlay — fades in on hover */}
      <div className="absolute inset-x-0 bottom-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-12 pb-3 px-3">
        <div className="flex items-center justify-between">
          <button type="button" onClick={onUseIdea}
            className="flex items-center gap-1.5 rounded-full bg-white/90 hover:bg-white px-3 py-1.5 text-[11px] font-bold text-slate-900 transition">
            <RotateCcw size={10} /> Use Idea
          </button>
          <button type="button" onClick={onToggleLike}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition ${item.liked ? 'bg-red-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}>
            <Heart size={12} className={item.liked ? 'fill-white' : ''} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── History card (masonry) ────────────────────────────────────────────────────

type MainTab = 'studio' | 'discover' | 'history';

function HistoryCard({ design, onDelete }: { design: UserDesign; onDelete: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${design.name}"?`)) return;
    setDeleting(true);
    try {
      await designService.delete(design.id);
      onDelete();
    } catch {
      setDeleting(false);
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (design.thumbnail_url) {
      navigator.clipboard.writeText(design.thumbnail_url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }
  };

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-2xl bg-slate-900 shadow-sm hover:shadow-xl transition-all duration-200"

    >
      {design.thumbnail_url ? (
        <img
          src={design.thumbnail_url}
          alt={design.name}
          className="w-full h-auto block transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="aspect-[4/5] bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center">
          <Image size={36} className="text-white/30" />
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      {/* Top action buttons */}
      <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Copy URL */}
        {design.thumbnail_url && (
          <button
            type="button"
            onClick={handleCopy}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white transition"
            title={copied ? 'Copied!' : 'Copy URL'}
          >
            {copied ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Copy size={12} />}
          </button>
        )}
        {/* Download */}
        {design.thumbnail_url && (
          <a
            href={design.thumbnail_url}
            download
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white transition"
            title="Download"
          >
            <Download size={12} />
          </a>
        )}
        {/* Delete */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-red-500 shadow hover:bg-white transition"
          title="Delete"
        >
          {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-0 inset-x-0 p-3 translate-y-2 group-hover:translate-y-0 opacity-0 group-hover:opacity-100 transition-all duration-200">
        <p className="text-sm font-bold text-white leading-snug truncate">{design.name}</p>
        <div className="flex items-center gap-1 mt-1">
          <Clock size={10} className="text-white/50" />
          <span className="text-[10px] text-white/50">{formatDate(design.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Generate panel (inline right sidebar) ────────────────────────────────────

// Generation is limited to GPT (OpenAI) and Gemini (Google) models —
// mirror ENABLED_IMAGE_PROVIDERS when re-enabling other providers.
const PANEL_IMAGE_MODELS = [
  { id: 'gpt-image-2.5-flare',    label: 'GPT Image 2.5 Flare',    tier: 'Fast',    credits: 8,  desc: 'Fast, high-quality everyday generation', badge: 'Popular' },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', tier: 'Premium', credits: 12, desc: 'Most capable; best for text in images' },
  { id: 'google-gemini-flash',    label: 'Gemini Flash Image', tier: 'Fast',    credits: 3, desc: 'Fast multimodal generation' },
  { id: 'google-gemini-nano-2',   label: 'Nano Banana 2',      tier: 'Quality', credits: 5, desc: 'Creative image generation', badge: 'NEW' },
  { id: 'google-gemini-nano-pro', label: 'Nano Banana Pro',    tier: 'Premium', credits: 8, desc: 'Pro-grade creative generation' },
  { id: 'google-imagen-4',        label: 'Imagen 4',           tier: 'Quality', credits: 6, desc: 'High-quality photorealistic' },
] as const;

const EDIT_TOOLS = [
  { id: 'upscale',          label: 'Upscale',          credits: 5,  desc: 'Increase image resolution up to 16×' },
  { id: 'relight',          label: 'Relight',          credits: 4,  desc: 'Change lighting and atmosphere' },
  { id: 'style-transfer',   label: 'Style Transfer',   credits: 5,  desc: 'Apply style from a reference image' },
  { id: 'remove-background',label: 'Remove Background',credits: 1,  desc: 'Remove background instantly' },
] as const;

type PanelMode = 'generate' | 'edit';
type EditTool  = typeof EDIT_TOOLS[number]['id'];
type ScaleFactor = '2x' | '4x' | '8x';

function GeneratePanel({
  tpl,
  useMode,
  onClose,
  onGenerated,
}: {
  tpl: CardTemplate;
  useMode: UseMode;
  onClose: () => void;
  onGenerated?: () => void;
}) {
  const imgToPromptRef   = useRef<HTMLInputElement>(null);
  const refUploadRef     = useRef<HTMLInputElement>(null);
  const editSourceRef    = useRef<HTMLInputElement>(null);
  const editRefRef       = useRef<HTMLInputElement>(null);

  // Generate mode state
  const [panelMode, setPanelMode]       = useState<PanelMode>('generate');
  const [prompt, setPrompt]             = useState(tpl.description || '');
  const [imgToPrompt, setImgToPrompt]   = useState<string | null>(useMode === 'prompt' ? tpl.coverImageUrl : null);
  const [refImage, setRefImage]         = useState<string | null>(useMode === 'ref'    ? tpl.coverImageUrl : null);
  const [selectedModel, setSelectedModel] = useState<string>(PANEL_IMAGE_MODELS[0].id); // gpt-image-2.5-flare default
  const [modelOpen, setModelOpen]       = useState(false);
  const [aspectRatio, setAspectRatio]   = useState('auto');
  const [resolution, setResolution]     = useState<'1k' | '2k' | '4k'>('2k');
  const [batchCount]                    = useState(1);
  const [aspectOpen, setAspectOpen]     = useState(false);
  const [resOpen, setResOpen]           = useState(false);
  const [improvingPrompt, setImprovingPrompt] = useState(false);
  const [generating, setGenerating]     = useState(false);
  const [resultUrls, setResultUrls]     = useState<string[]>([]);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);

  // Edit mode state
  const [editTool, setEditTool]         = useState<EditTool>('upscale');
  const [editSource, setEditSource]     = useState<string | null>(null);
  const [editRef, setEditRef]           = useState<string | null>(null);
  const [editPrompt, setEditPrompt]     = useState('');
  const [scaleFactor, setScaleFactor]   = useState<ScaleFactor>('2x');
  const [relightStyle, setRelightStyle] = useState('standard');
  const [styleStrength, setStyleStrength] = useState(80);
  const [structureStrength, setStructureStrength] = useState(50);
  const [editResult, setEditResult]     = useState<string | null>(null);
  const [editGenerating, setEditGenerating] = useState(false);
  const [editError, setEditError]       = useState<string | null>(null);

  const currentModelInfo = PANEL_IMAGE_MODELS.find(m => m.id === selectedModel) ?? PANEL_IMAGE_MODELS[0];
  const currentEditTool  = EDIT_TOOLS.find(t => t.id === editTool) ?? EDIT_TOOLS[0];

  const handleImgToPromptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => setImgToPrompt(r.result as string); r.readAsDataURL(file);
  };
  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => setRefImage(r.result as string); r.readAsDataURL(file);
  };
  const handleEditSourceUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => setEditSource(r.result as string); r.readAsDataURL(file);
  };
  const handleEditRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader(); r.onload = () => setEditRef(r.result as string); r.readAsDataURL(file);
  };

  const doImprovePrompt = async () => {
    if (!prompt.trim() || improvingPrompt) return;
    setImprovingPrompt(true);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/magnific/improve-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const d = await res.json();
      if (d.success && d.prompt) setPrompt(d.prompt);
    } catch { /* silent */ } finally { setImprovingPrompt(false); }
  };

  const doGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true); setErrorMsg(null); setResultUrls([]);
    try {
      const ar = aspectRatio === 'auto' ? '1:1' : aspectRatio;
      const endpoint = GOOGLE_IMAGE_MODEL_IDS.has(selectedModel) ? '/api/google/generate-image'
                     : OPENAI_IMAGE_MODEL_IDS.has(selectedModel) ? '/api/openai/generate-image'
                     : '/api/nova/generate-image';
      const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ prompt: prompt.trim(), model: selectedModel, aspect_ratio: ar, save: true }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Generation failed');
      if (d.url) setResultUrls([d.url]);
      onGenerated?.();
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Generation failed');
    } finally { setGenerating(false); }
  };

  const doEdit = async () => {
    if (!editSource || editGenerating) return;
    setEditGenerating(true); setEditError(null); setEditResult(null);
    try {
      const body: Record<string, any> = { type: editTool };
      if (editTool === 'remove-background') {
        body.image_url = editSource;
      } else {
        body.image = editSource;
        if (editPrompt) body.prompt = editPrompt;
        if (editTool === 'upscale') body.scale_factor = scaleFactor;
        if (editTool === 'relight') body.style = relightStyle;
        if (editTool === 'style-transfer') {
          if (!editRef) { setEditError('Reference image is required for Style Transfer'); setEditGenerating(false); return; }
          body.reference_image = editRef;
          body.style_strength = styleStrength;
          body.structure_strength = structureStrength;
        }
      }
      const res = await fetch(`${getApiBaseUrl()}/api/magnific/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Edit failed');
      setEditResult(d.url);
    } catch (err: any) {
      setEditError(err.message ?? 'Edit failed');
    } finally { setEditGenerating(false); }
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
        {/* Mode toggle */}
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {(['generate', 'edit'] as PanelMode[]).map(m => (
            <button key={m} type="button" onClick={() => setPanelMode(m)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold capitalize transition ${
                panelMode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {m}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 transition">
            <Maximize2 size={13} />
          </button>
          <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 transition">
            <X size={13} />
          </button>
        </div>
      </div>

      {panelMode === 'generate' ? (
        <>
          <div className="flex-1 overflow-y-auto">
            {/* Image to Prompt */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition"
              onClick={() => imgToPromptRef.current?.click()}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                <Image size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-700">Image to Prompt</p>
                <p className="text-[10px] text-slate-400">Upload image to generate a prompt</p>
              </div>
              {imgToPrompt && (
                <div className="relative">
                  <img src={imgToPrompt} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover border border-slate-200" />
                  <button type="button" onClick={e => { e.stopPropagation(); setImgToPrompt(null); }}
                    className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white text-[8px]">✕</button>
                </div>
              )}
            </div>
            <input ref={imgToPromptRef} type="file" accept="image/*" className="hidden" onChange={handleImgToPromptUpload} />

            {/* Drop or upload reference */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition"
              onClick={() => refUploadRef.current?.click()}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                <Image size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-500">Drop or upload reference</p>
                <p className="text-[10px] text-slate-400">optional</p>
              </div>
              {refImage ? (
                <div className="relative">
                  <img src={refImage} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover border border-slate-200" />
                  <button type="button" onClick={e => { e.stopPropagation(); setRefImage(null); }}
                    className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white text-[8px]">✕</button>
                </div>
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
                  <Plus size={12} />
                </div>
              )}
            </div>
            <input ref={refUploadRef} type="file" accept="image/*" className="hidden" onChange={handleRefUpload} />

            {/* Prompt + Improve */}
            <div className="px-4 pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-slate-700">Prompt</span>
                <button type="button" disabled={!prompt.trim() || improvingPrompt} onClick={doImprovePrompt}
                  title="Improve prompt with Magnific AI"
                  className="flex items-center gap-1 text-[10px] text-[#2563EB] hover:text-[#4a5ae0] disabled:opacity-40 disabled:cursor-not-allowed transition font-semibold">
                  {improvingPrompt ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                  Improve
                </button>
              </div>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={8}
                placeholder="Describe what you want to generate…"
                className="w-full resize-none border-0 bg-transparent text-[11px] text-slate-800 placeholder-slate-300 outline-none leading-relaxed" />
            </div>

            {/* Controls row: batch / lock / aspect / resolution */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100">
              <button type="button" className="text-slate-400 hover:text-slate-700 text-xs font-bold px-0.5">−</button>
              <span className="text-[11px] font-semibold text-slate-600">{batchCount}/4</span>
              <div className="relative group/lock">
                <button type="button" className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 transition">
                  <Lock size={11} />
                </button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/lock:block whitespace-nowrap rounded-lg bg-slate-800 px-2 py-1 text-[10px] text-white shadow-lg z-50 pointer-events-none">
                  Upgrade to unlock batch generation
                </div>
              </div>

              {/* Aspect ratio */}
              <div className="relative">
                <button type="button" onClick={() => { setAspectOpen(o => !o); setResOpen(false); }}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 transition">
                  <Maximize2 size={9} /> {aspectRatio === 'auto' ? 'Auto' : aspectRatio}
                </button>
                {aspectOpen && (
                  <div className="absolute top-full left-0 mt-1 z-50 w-24 rounded-xl border border-slate-200 bg-white shadow-xl overflow-auto max-h-64">
                    {['auto', ...ASPECT_RATIOS].map(r => (
                      <button key={r} type="button" onClick={() => { setAspectRatio(r); setAspectOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-slate-50 transition ${aspectRatio === r ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
                        {r === 'auto' ? 'Auto' : r}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Resolution */}
              <div className="relative">
                <button type="button" onClick={() => { setResOpen(o => !o); setAspectOpen(false); }}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:border-slate-300 transition">
                  ↔ {resolution.toUpperCase()}
                </button>
                {resOpen && (
                  <div className="absolute top-full left-0 mt-1 z-50 w-52 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                    {[
                      { key: '1k', label: '1K', desc: 'Recommended For Most Use Cases', locked: false },
                      { key: '2k', label: '2K', desc: 'Higher Detail, Balanced',         locked: false },
                      { key: '4k', label: '4K', desc: 'Upgrade to unlock 4K resolution', locked: true  },
                    ].map(r => (
                      <button key={r.key} type="button" disabled={r.locked}
                        onClick={() => { if (!r.locked) { setResolution(r.key as any); setResOpen(false); } }}
                        className={`w-full flex flex-col text-left px-3 py-2.5 hover:bg-slate-50 transition disabled:cursor-not-allowed ${resolution === r.key ? 'bg-slate-50' : ''}`}>
                        <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800">
                          {r.label} {r.locked && <Lock size={9} className="text-slate-400" />}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">{r.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Model selector */}
            <div className="px-4 py-3 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 mb-2">Model</p>
              <div className="relative">
                <button type="button" onClick={() => setModelOpen(o => !o)}
                  className="w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 hover:border-slate-300 transition">
                  <Sparkles size={12} className="text-[#2563EB] shrink-0" />
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-800">{currentModelInfo.label}</span>
                      {'badge' in currentModelInfo && currentModelInfo.badge && (
                        <span className="rounded-full bg-[#2563EB]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#2563EB]">{currentModelInfo.badge}</span>
                      )}
                    </div>
                    <span className="text-[9px] text-slate-400">{currentModelInfo.desc}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-[#2563EB]">✦{currentModelInfo.credits}</span>
                    <ChevronDown size={12} className="text-slate-400" />
                  </div>
                </button>
                {modelOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                    {(['Fast', 'Quality', 'Premium'] as const).map(tier => {
                      const tierModels = PANEL_IMAGE_MODELS.filter(m => m.tier === tier);
                      return (
                        <div key={tier}>
                          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{tier}</span>
                          </div>
                          {tierModels.map(m => (
                            <button key={m.id} type="button" onClick={() => { setSelectedModel(m.id); setModelOpen(false); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition ${selectedModel === m.id ? 'bg-[#2563EB]/5' : ''}`}>
                              <div className="flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-semibold text-slate-800">{m.label}</span>
                                  {'badge' in m && m.badge && (
                                    <span className="rounded-full bg-[#2563EB]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#2563EB]">{m.badge}</span>
                                  )}
                                </div>
                                <span className="text-[9px] text-slate-400">{m.desc}</span>
                              </div>
                              <span className="text-[10px] font-bold text-[#2563EB]">✦{m.credits}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {errorMsg && (
              <div className="mx-4 mb-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-600">{errorMsg}</div>
            )}

            {resultUrls.length > 0 && (
              <div className="px-4 pb-3 space-y-2">
                {resultUrls.map((url, i) => (
                  <div key={i} className="rounded-xl overflow-hidden border border-slate-200">
                    <img src={url} alt="Generated" className="w-full" />
                    <div className="p-2 flex gap-1.5">
                      <a href={url} download target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                        <Download size={10} /> Download
                      </a>
                      <button type="button" onClick={() => setResultUrls([])}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                        <RefreshCw size={10} /> New
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Generate button */}
          <div className="px-4 py-3 border-t border-slate-100 shrink-0">
            <button type="button" disabled={!prompt.trim() || generating} onClick={doGenerate}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-[0.98]">
              {generating ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <><Sparkles size={14} /> Generate ✦{currentModelInfo.credits}</>}
            </button>
          </div>
        </>
      ) : (
        /* ── Edit mode ── */
        <>
          <div className="flex-1 overflow-y-auto">
            {/* Tool selector */}
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[10px] text-slate-400 mb-2">Edit Tool</p>
              <div className="grid grid-cols-2 gap-1.5">
                {EDIT_TOOLS.map(t => (
                  <button key={t.id} type="button" onClick={() => { setEditTool(t.id); setEditResult(null); setEditError(null); }}
                    className={`flex flex-col items-start rounded-xl border px-2.5 py-2 text-left transition ${
                      editTool === t.id ? 'border-[#2563EB] bg-[#2563EB]/5' : 'border-slate-200 hover:border-slate-300'
                    }`}>
                    <span className="text-[10px] font-bold text-slate-800">{t.label}</span>
                    <span className="text-[9px] text-slate-400 mt-0.5 leading-tight">{t.desc}</span>
                    <span className="mt-1 text-[9px] font-bold text-[#2563EB]">✦{t.credits}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Source image upload */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition"
              onClick={() => editSourceRef.current?.click()}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                <Image size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-700">Source Image</p>
                <p className="text-[10px] text-slate-400">Required — tap to upload</p>
              </div>
              {editSource ? (
                <div className="relative">
                  <img src={editSource} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover border border-slate-200" />
                  <button type="button" onClick={e => { e.stopPropagation(); setEditSource(null); }}
                    className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white text-[8px]">✕</button>
                </div>
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white text-slate-400">
                  <Plus size={12} />
                </div>
              )}
            </div>
            <input ref={editSourceRef} type="file" accept="image/*" className="hidden" onChange={handleEditSourceUpload} />

            {/* Reference image (style-transfer only) */}
            {editTool === 'style-transfer' && (
              <>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition"
                  onClick={() => editRefRef.current?.click()}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                    <Layers size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-slate-700">Style Reference</p>
                    <p className="text-[10px] text-slate-400">Required for style transfer</p>
                  </div>
                  {editRef ? (
                    <div className="relative">
                      <img src={editRef} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover border border-slate-200" />
                      <button type="button" onClick={e => { e.stopPropagation(); setEditRef(null); }}
                        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white text-[8px]">✕</button>
                    </div>
                  ) : (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white text-slate-400">
                      <Plus size={12} />
                    </div>
                  )}
                </div>
                <input ref={editRefRef} type="file" accept="image/*" className="hidden" onChange={handleEditRefUpload} />
              </>
            )}

            {/* Tool-specific controls */}
            <div className="px-4 py-3 border-b border-slate-100 space-y-3">
              {editTool === 'upscale' && (
                <div>
                  <p className="text-[10px] text-slate-400 mb-1.5">Scale factor</p>
                  <div className="flex gap-1.5">
                    {(['2x', '4x', '8x'] as ScaleFactor[]).map(s => (
                      <button key={s} type="button" onClick={() => setScaleFactor(s)}
                        className={`flex-1 rounded-lg border py-1.5 text-[10px] font-bold transition ${
                          scaleFactor === s ? 'border-slate-800 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {editTool === 'relight' && (
                <div>
                  <p className="text-[10px] text-slate-400 mb-1.5">Lighting style</p>
                  <select value={relightStyle} onChange={e => setRelightStyle(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-[#2563EB]">
                    {['standard','smooth','brighter','contrasted_n_hdr','warm','cool','dramatic','golden_hour','neon'].map(s => (
                      <option key={s} value={s}>{s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>
                    ))}
                  </select>
                </div>
              )}
              {editTool === 'style-transfer' && (
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between mb-1">
                      <p className="text-[10px] text-slate-400">Style strength</p>
                      <span className="text-[10px] font-bold text-slate-600">{styleStrength}%</span>
                    </div>
                    <input type="range" min={0} max={100} value={styleStrength} onChange={e => setStyleStrength(+e.target.value)}
                      className="w-full accent-[#2563EB]" />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <p className="text-[10px] text-slate-400">Structure strength</p>
                      <span className="text-[10px] font-bold text-slate-600">{structureStrength}%</span>
                    </div>
                    <input type="range" min={0} max={100} value={structureStrength} onChange={e => setStructureStrength(+e.target.value)}
                      className="w-full accent-[#2563EB]" />
                  </div>
                </div>
              )}
              {editTool !== 'remove-background' && (
                <div>
                  <p className="text-[10px] text-slate-400 mb-1.5">Guidance prompt (optional)</p>
                  <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} rows={3}
                    placeholder="Describe the desired result…"
                    className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-800 placeholder-slate-300 outline-none focus:border-[#2563EB]" />
                </div>
              )}
            </div>

            {editError && (
              <div className="mx-4 mt-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-600">{editError}</div>
            )}

            {editResult && (
              <div className="px-4 py-3 space-y-2">
                <div className="rounded-xl overflow-hidden border border-slate-200">
                  <img src={editResult} alt="Result" className="w-full" />
                  <div className="p-2 flex gap-1.5">
                    <a href={editResult} download target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                      <Download size={10} /> Download
                    </a>
                    <button type="button" onClick={() => setEditResult(null)}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 transition">
                      <RefreshCw size={10} /> New
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Apply button */}
          <div className="px-4 py-3 border-t border-slate-100 shrink-0">
            <button type="button" disabled={!editSource || editGenerating} onClick={doEdit}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-[0.98]">
              {editGenerating ? <><Loader2 size={14} className="animate-spin" /> Processing…</> : <><Edit3 size={14} /> Apply {currentEditTool.label} ✦{currentEditTool.credits}</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const Cards = () => {
  const [tab, setTab]               = useState<MainTab>('studio');
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all');
  const [sortBy, setSortBy]         = useState<SortMode>('featured');
  const [generateItem, setGenerateItem] = useState<DiscoverItem | null>(null);
  const [generateMode, setGenerateMode] = useState<UseMode>('prompt');
  const [myDesigns, setMyDesigns]   = useState<UserDesign[]>([]);
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [previewItem, setPreviewItem] = useState<DiscoverItem | null>(null);
  const [creditRefreshKey, setCreditRefreshKey] = useState(0);

  const fetchDesigns = useCallback(async () => {
    setLoadingDesigns(true);
    try {
      const list = await designService.list();
      setMyDesigns(list);
    } catch { /* ignore */ }
    finally { setLoadingDesigns(false); }
  }, []);

  useEffect(() => { fetchDesigns(); }, [fetchDesigns]);

  const handleDesignSaved = (_saved?: UserDesign) => { fetchDesigns(); };
  const handleCreditUsed = useCallback(() => setCreditRefreshKey((k) => k + 1), []);

  // MCP media (MeiGen gallery) — the primary Discover source. Paged: first
  // page on tab/filter change, further pages via Show more / infinite scroll.
  const MCP_PAGE_SIZE = 60;
  const [mcpMedia, setMcpMedia] = useState<Array<Record<string, any>>>([]);
  const [loadingMcp, setLoadingMcp] = useState(false);
  const [loadingMoreMcp, setLoadingMoreMcp] = useState(false);
  const [mcpHasMore, setMcpHasMore] = useState(false);
  const mcpSentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchMcpPage = useCallback((offset: number, append: boolean) => {
    (append ? setLoadingMoreMcp : setLoadingMcp)(true);
    fetch(`${getApiBaseUrl()}/api/mcp/media?tab=${modelFilter}&sort=${sortBy}&limit=${MCP_PAGE_SIZE}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        const page: Array<Record<string, any>> = d.media ?? [];
        setMcpMedia((prev) => {
          if (!append) return page;
          const seen = new Set(prev.map((m) => String(m.id)));
          return [...prev, ...page.filter((m) => !seen.has(String(m.id)))];
        });
        setMcpHasMore(page.length === MCP_PAGE_SIZE);
      })
      .catch(() => {})
      .finally(() => (append ? setLoadingMoreMcp : setLoadingMcp)(false));
  }, [modelFilter, sortBy]);

  useEffect(() => {
    if (tab !== 'discover') return;
    fetchMcpPage(0, false);
  }, [tab, fetchMcpPage]);

  // Auto-load the next page when the sentinel below the grid scrolls into view
  useEffect(() => {
    if (tab !== 'discover' || !mcpHasMore) return;
    const el = mcpSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loadingMoreMcp && !loadingMcp) {
        fetchMcpPage(mcpMedia.length, true);
      }
    }, { rootMargin: '400px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [tab, mcpHasMore, mcpMedia.length, loadingMoreMcp, loadingMcp, fetchMcpPage]);

  // Discover shows ONLY MeiGen (MCP) media — local admin templates were
  // removed from this feed by request.
  const discoverItems = useMemo<DiscoverItem[]>(() => mcpMedia.map((m) => ({
    key: `mcp-${m.id}`, source: 'mcp', id: String(m.id),
    name: m.title || m.model || 'AI image',
    prompt: m.prompt || '',
    imageUrl: m.image_url || m.thumb_url || null,
    model: m.model || null,
    likeCount: Number(m.likes_count ?? 0),
    liked: Boolean(m.liked),
    createdAt: m.created_at || new Date().toISOString(),
  })), [mcpMedia]);

  const toggleItemLike = useCallback((item: DiscoverItem) => {
    fetch(`${getApiBaseUrl()}/api/mcp/media/${item.id}/like`, { method: 'POST', headers: { Authorization: `Bearer ${tok()}` } })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        const liked = Boolean(d.liked);
        const count = Number(d.likes_count ?? 0);
        setMcpMedia((prev) => prev.map((m) => String(m.id) === item.id ? { ...m, liked, likes_count: count } : m));
        setPreviewItem((prev) => prev && prev.id === item.id ? { ...prev, liked, likeCount: count } : prev);
      })
      .catch(() => {});
  }, []);

  // A DiscoverItem viewed as the template shape the GeneratePanel expects.
  const itemAsTemplate = (item: DiscoverItem): CardTemplate => ({
    id: item.id, name: item.name, description: item.prompt,
    designData: {}, coverImageUrl: item.imageUrl, isPublished: true,
    createdAt: item.createdAt, updatedAt: item.createdAt,
  });

  const openSimilar = useCallback(async (id: string) => {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/mcp/media/${id}`, { headers: { Authorization: `Bearer ${tok()}` } });
      const d = await r.json();
      if (!d.success || !d.media) return;
      const m = d.media;
      setPreviewItem({
        key: `mcp-${m.id}`, source: 'mcp', id: String(m.id),
        name: m.title || m.model || 'AI image', prompt: m.prompt || '',
        imageUrl: m.image_url || m.thumb_url || null, model: m.model || null,
        likeCount: Number(m.likes_count ?? 0), liked: Boolean(m.liked),
        createdAt: m.created_at || new Date().toISOString(),
      });
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="text-4xl font-black text-slate-900">My Studio</h1>
            <p className="mt-2 text-base text-slate-600">
              Generate AI-powered designs tailored to your brand, or build from scratch.
            </p>
          </div>
          <CreditBadge refreshKey={creditRefreshKey} />
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {([
          { id: 'studio'   as const, label: 'AI Studio', icon: <Sparkles      size={14} /> },
          { id: 'discover' as const, label: 'Discover',  icon: <LayoutTemplate size={14} /> },
          { id: 'history'  as const, label: 'History',   icon: <Image          size={14} /> },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === t.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'studio' ? (
        <AIStudio onDesignSaved={handleDesignSaved} onCreditUsed={handleCreditUsed} />
      ) : tab === 'discover' ? (
        <div className="space-y-4">
          {/* Model filter tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            {MODEL_TABS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModelFilter(m.id)}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  modelFilter === m.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {m.label}
                {m.badge && (
                  <span className="rounded-full bg-[#2563EB] px-1.5 py-0.5 text-[9px] font-bold text-white leading-none">
                    {m.badge}
                  </span>
                )}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              {(['featured', 'newest', 'popular'] as SortMode[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSortBy(s)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    sortBy === s
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Gallery + inline generate panel */}
          <div className="flex gap-4 items-start">
            {/* Masonry gallery */}
            <div className="flex-1 min-w-0">
              {loadingMcp && discoverItems.length === 0 ? (
                <div className={`gap-4 ${generateItem ? 'columns-2 sm:columns-2 lg:columns-3' : 'columns-2 sm:columns-3 lg:columns-4 xl:columns-5'}`}>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="break-inside-avoid mb-4 rounded-xl bg-[#efe9df] animate-pulse"
                      style={{ height: `${180 + (i % 4) * 60}px` }} />
                  ))}
                </div>
              ) : discoverItems.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center py-16 gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                    <LayoutTemplate size={24} className="text-slate-400" />
                  </div>
                  <p className="font-bold text-slate-700">Nothing here yet</p>
                  <p className="text-sm text-slate-400">Connect the MeiGen MCP server in Admin → MCP to fill the Discover feed.</p>
                </div>
              ) : (
                <div className={`gap-4 ${generateItem ? 'columns-2 sm:columns-2 lg:columns-3' : 'columns-2 sm:columns-3 lg:columns-4 xl:columns-5'}`}>
                  {discoverItems.map((item) => (
                    <div key={item.key} className="break-inside-avoid mb-4">
                      <DiscoverCard
                        item={item}
                        onPreview={() => setPreviewItem(item)}
                        onUseIdea={(e) => {
                          e.stopPropagation();
                          setGenerateItem(item);
                          setGenerateMode('prompt');
                        }}
                        onToggleLike={(e) => {
                          e.stopPropagation();
                          toggleItemLike(item);
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
              {mcpHasMore && discoverItems.length > 0 && (
                <div ref={mcpSentinelRef} className="flex justify-center py-5">
                  <button
                    type="button"
                    onClick={() => fetchMcpPage(mcpMedia.length, true)}
                    disabled={loadingMoreMcp}
                    className="rounded-full border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
                  >
                    {loadingMoreMcp ? 'Loading…' : 'Show more'}
                  </button>
                </div>
              )}
            </div>

            {/* Inline generate panel */}
            {generateItem && (
              <div className="w-80 shrink-0 sticky top-4">
                <GeneratePanel
                  tpl={itemAsTemplate(generateItem)}
                  useMode={generateMode}
                  onClose={() => setGenerateItem(null)}
                  onGenerated={() => { fetchDesigns(); handleCreditUsed(); }}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          {loadingDesigns ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
              <Loader2 size={16} className="animate-spin" /> Loading your designs…
            </div>
          ) : myDesigns.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center py-16 gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                <Image size={24} className="text-slate-400" />
              </div>
              <div className="text-center">
                <p className="font-bold text-slate-700">No designs yet</p>
                <p className="text-sm text-slate-400 mt-1">Generate an AI design or start with a blank canvas.</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setTab('studio')}
                  className="flex items-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-bold text-white hover:bg-indigo-600 transition"
                >
                  <Sparkles size={14} /> AI Studio
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`Delete all ${myDesigns.length} items from your history? This cannot be undone.`)) return;
                    void designService.clearAll().then(() => setMyDesigns([])).catch(() => {});
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition"
                >
                  <Trash2 size={12} /> Clear history
                </button>
              </div>
              <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-4">
                {myDesigns.map((d) => (
                  <div key={d.id} className="break-inside-avoid mb-4">
                    <HistoryCard
                      design={d}
                      onDelete={() => setMyDesigns((prev) => prev.filter((x) => x.id !== d.id))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Preview modal */}
      {previewItem && (
        <ImagePreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onToggleLike={() => toggleItemLike(previewItem)}
          onOpenSimilar={(id) => void openSimilar(id)}
          onUseAsPrompt={() => {
            setGenerateItem(previewItem);
            setGenerateMode('prompt');
            setPreviewItem(null);
            setTab('discover');
          }}
          onUseAsRef={() => {
            setGenerateItem(previewItem);
            setGenerateMode('ref');
            setPreviewItem(null);
            setTab('discover');
          }}
        />
      )}
    </div>
  );
};

export default Cards;
