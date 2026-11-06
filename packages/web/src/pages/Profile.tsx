import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Globe,
  Image as ImageIcon,
  Mail,
  MapPin,
  Phone,
  Save,
  User,
  FileText,
  Plus,
  Loader2,
} from 'lucide-react';
import { AppUser, normalizeUser } from '../utils/userSession';
import { blogService, type BlogPost } from '../services/blogService';
import { mediaService } from '../services/mediaService';
import { compressImage } from '../utils/imageCompression';

type ProfileProps = {
  currentUser: AppUser | null;
  onUserUpdated: (user: AppUser) => void;
};

type ProfileForm = {
  name: string;
  username: string;
  email: string;
  phone: string;
  country: string;
  avatar: string;
  cover: string;
  bio: string;
  website: string;
};

type ProfileResponse = {
  success: boolean;
  error?: string;
  user?: Partial<AppUser> & { id?: string; email?: string };
};

const safeJson = async <T,>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com')
  ? ''
  : rawApiBaseUrl.replace(/\/$/, '');

const defaultCover =
  'linear-gradient(135deg, rgba(15,23,42,0.88), rgba(37,99,235,0.72) 42%, rgba(56,189,248,0.62) 100%)';

function toProfileForm(user: AppUser | null): ProfileForm {
  return {
    name: user?.name ?? '',
    username: user?.username ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    country: user?.country ?? '',
    avatar: user?.avatar ?? '',
    cover: user?.cover ?? '',
    bio:
      'Tell your audience what you do, what you build, and what kind of content they should expect from your profile.',
    website: user?.website ?? '',
  };
}

function Profile({ currentUser, onUserUpdated }: ProfileProps) {
  const [form, setForm] = useState<ProfileForm>(() => toProfileForm(currentUser));
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [uploadingField, setUploadingField] = useState<'avatar' | 'cover' | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [recentPosts, setRecentPosts] = useState<BlogPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  useEffect(() => {
    setForm(toProfileForm(currentUser));
  }, [currentUser]);

  useEffect(() => {
    blogService.listPosts({ status: 'published' })
      .then((data) => setRecentPosts(data.slice(0, 6)))
      .catch(() => setRecentPosts([]))
      .finally(() => setPostsLoading(false));
  }, []);

  const missingFields = useMemo(() => {
    return ['name', 'username', 'email', 'phone', 'country'].filter(
      (field) => !form[field as keyof Pick<ProfileForm, 'name' | 'username' | 'email' | 'phone' | 'country'>].trim(),
    );
  }, [form]);

  const profileStrength = missingFields.length === 0 ? 'Profile complete' : 'Profile can be improved';
  const profileSubtitle =
    missingFields.length === 0
      ? 'Your public details are filled in and ready to share.'
      : `Still missing: ${missingFields.join(', ')}`;

  const handleChange = (field: keyof ProfileForm, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setSuccessMessage(null);
  };

  const handleImageUpload = async (
    event: ChangeEvent<HTMLInputElement>,
    field: 'avatar' | 'cover',
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadingField(field);
      const compressed = await compressImage(file);
      const uploadedName = `${field}-${Date.now()}-${file.name}`;
      const saved = await mediaService.upload({
        url: compressed.url,
        thumbnail_url: compressed.thumbnail_url,
        file_name: uploadedName,
        original_name: file.name,
        file_size: compressed.file_size,
        file_type: compressed.file_type,
        width: compressed.width,
        height: compressed.height,
        force: true,
      });
      handleChange(field, saved.url);
    } catch (error) {
      const duplicate = error as Error & { isDuplicate?: boolean; existingImage?: { url?: string } };
      if (duplicate?.isDuplicate && duplicate.existingImage?.url) {
        handleChange(field, duplicate.existingImage.url);
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to upload image');
      }
    } finally {
      setUploadingField(null);
      event.target.value = '';
    }
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!form.name.trim() || !form.username.trim() || !form.email.trim()) {
      setErrorMessage('Name, username, and email are required.');
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) {
      setErrorMessage('Your session expired. Please log in again.');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: form.name.trim(),
          username: form.username.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          country: form.country.trim(),
          website: form.website.trim(),
          avatar: form.avatar,
          cover: form.cover,
        }),
      });

      const payload = await safeJson<ProfileResponse>(response);
      if (!payload) {
        throw new Error('The server returned an empty response. Restart the backend and try again.');
      }

      if (!response.ok || !payload.success || !payload.user?.id || !payload.user?.email) {
        throw new Error(payload.error || 'Failed to save profile');
      }

      const updatedUser = normalizeUser({
        id: payload.user.id,
        email: payload.user.email,
        name: payload.user.name ?? null,
        username: payload.user.username ?? null,
        phone: payload.user.phone ?? null,
        country: payload.user.country ?? null,
        website: payload.user.website ?? null,
        role: payload.user.role === 'admin' ? 'admin' : 'user',
        avatar: payload.user.avatar ?? null,
        cover: payload.user.cover ?? null,
      });

      onUserUpdated(updatedUser);
      setForm((previous) => ({
        ...previous,
        avatar: updatedUser.avatar ?? '',
        cover: updatedUser.cover ?? '',
      }));
      setSuccessMessage('Profile saved successfully.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Profile</h1>
        <p className="mt-2 text-base text-slate-500">Shape how your Dakyworld hub profile appears across the workspace.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_320px]">
        <form onSubmit={handleSave} className="space-y-6">
          <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white">
            <div className="relative h-[230px] border-b border-slate-200 bg-slate-100">
              <div
                className="absolute inset-0"
                style={
                  form.cover
                    ? {
                        backgroundImage: `url("${form.cover}")`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : { backgroundImage: defaultCover }
                }
              />
              <div className="absolute inset-0 bg-black/8" />

              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                onChange={(event) => void handleImageUpload(event, 'cover')}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="absolute right-5 top-5 inline-flex items-center gap-2 rounded-2xl bg-white/90 px-4 py-2 text-sm font-semibold text-slate-800 backdrop-blur"
              >
                <ImageIcon size={16} />
                {uploadingField === 'cover' ? 'Uploading…' : 'Change cover'}
              </button>
            </div>

            <div className="relative px-6 pb-6 pt-0 md:px-8">
              <div className="-mt-14 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
                  <div className="relative h-28 w-28 shrink-0 rounded-full border-[6px] border-white bg-slate-200 shadow-sm">
                    {form.avatar ? (
                      <img src={form.avatar} alt={form.name || 'Profile'} className="h-full w-full rounded-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-100 text-slate-400">
                        <User size={34} />
                      </div>
                    )}

                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(event) => void handleImageUpload(event, 'avatar')}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="absolute bottom-0 right-0 flex h-10 w-10 items-center justify-center rounded-full border-4 border-white bg-slate-950 text-white"
                    >
                      <Camera size={16} />
                    </button>
                  </div>

                  <div className="min-w-0 pt-2">
                    <div className="text-[2rem] font-black tracking-[-0.04em] text-slate-950">
                      {form.name || 'Your name'}
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-500">
                      @{form.username || 'username'} · Dakyworld hub member
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        form.country || 'Country',
                        form.phone || 'Phone',
                        form.email || 'Email',
                      ].map((item) => (
                        <span key={item} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                  >
                    {uploadingField === 'avatar' ? 'Uploading…' : 'Edit photo'}
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving || uploadingField !== null}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    <Save size={16} />
                    {isSaving ? 'Saving...' : 'Save profile'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-6 md:p-8">
            <h2 className="text-2xl font-black text-slate-950">About Me</h2>
            <p className="mt-2 text-sm text-slate-500">Update your main details, bio, and contact information.</p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'username', label: 'Username', type: 'text' },
                { key: 'email', label: 'Email', type: 'email' },
                { key: 'phone', label: 'Phone', type: 'tel' },
                { key: 'country', label: 'Country', type: 'text' },
                { key: 'website', label: 'Website', type: 'url' },
              ].map((field) => (
                <label key={field.key} className="block space-y-2">
                  <span className="text-sm font-semibold text-slate-700">{field.label}</span>
                  <input
                    type={field.type}
                    value={form[field.key as keyof Pick<ProfileForm, 'name' | 'username' | 'email' | 'phone' | 'country' | 'website'>]}
                    onChange={(event) =>
                      handleChange(
                        field.key as keyof Pick<ProfileForm, 'name' | 'username' | 'email' | 'phone' | 'country' | 'website'>,
                        event.target.value,
                      )
                    }
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400"
                  />
                </label>
              ))}
            </div>

            <label className="mt-4 block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Bio</span>
              <textarea
                rows={6}
                value={form.bio}
                onChange={(event) => handleChange('bio', event.target.value)}
                className="min-h-[170px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-900 outline-none transition-colors focus:border-slate-400"
              />
            </label>

            {(errorMessage || successMessage) && (
              <div
                className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
                  errorMessage
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                }`}
              >
                {errorMessage || successMessage}
              </div>
            )}
          </section>
        </form>

        <div className="space-y-6">
          <section className="rounded-[30px] border border-slate-200 bg-white p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 text-emerald-600" size={20} />
              <div>
                <div className="text-lg font-black text-slate-950">{profileStrength}</div>
                <p className="mt-1 text-sm leading-6 text-slate-500">{profileSubtitle}</p>
              </div>
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-6">
            <h3 className="text-lg font-black text-slate-950">Location</h3>
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-600">
              <MapPin size={16} className="text-slate-400" />
              {form.country || 'Add your country'}
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-6">
            <h3 className="text-lg font-black text-slate-950">Connect</h3>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex items-center gap-3">
                <Mail size={16} className="text-slate-400" />
                {form.email || 'Add your email'}
              </div>
              <div className="flex items-center gap-3">
                <Phone size={16} className="text-slate-400" />
                {form.phone || 'Add your phone'}
              </div>
              <div className="flex items-center gap-3">
                <Globe size={16} className="text-slate-400" />
                {form.website || 'Add your website'}
              </div>
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-6">
            <h3 className="text-lg font-black text-slate-950">Profile Media</h3>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-800">Cover image</span>
                  <span className="block text-xs text-slate-500">Recommended wide banner image</span>
                </span>
                <ImageIcon size={18} className="text-slate-400" />
              </button>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-800">Profile image</span>
                  <span className="block text-xs text-slate-500">Recommended square image</span>
                </span>
                <Camera size={18} className="text-slate-400" />
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Your Posts grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Your Posts</h2>
          <a
            href="/posts"
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, '', '/posts');
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
            className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Plus size={15} /> New Post
          </a>
        </div>

        {postsLoading
          ? <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-slate-300" size={28} />
            </div>
          : recentPosts.length === 0
            ? <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 py-14">
                <FileText size={32} className="text-slate-200" />
                <p className="text-sm text-slate-400">No published posts yet.</p>
                <a
                  href="/posts"
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, '', '/posts');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Go to Posts
                </a>
              </div>
            : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recentPosts.map((post) => (
                  <div key={post.id} className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white hover:shadow-md transition-shadow">
                    {post.featured_image
                      ? <img src={post.featured_image} alt={post.title} className="h-44 w-full object-cover" />
                      : <div className="flex h-44 items-center justify-center bg-slate-100">
                          <FileText size={28} className="text-slate-300" />
                        </div>
                    }
                    <div className="flex flex-1 flex-col p-4 gap-2">
                      {post.category_name && (
                        <span className="text-xs font-bold uppercase tracking-wide text-[#e6332a]">{post.category_name}</span>
                      )}
                      <h3 className="text-sm font-bold text-slate-900 line-clamp-2 leading-snug">{post.title || '(Untitled)'}</h3>
                      {post.excerpt && (
                        <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{post.excerpt}</p>
                      )}
                      <div className="mt-auto flex items-center gap-2 pt-2">
                        {post.tag_names?.slice(0, 2).map((tag) => (
                          <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
        }
      </section>
    </div>
  );
}

export default Profile;
