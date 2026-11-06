export type AppUser = {
  id: string;
  name: string | null;
  email: string;
  username: string | null;
  phone: string | null;
  country: string | null;
  website: string | null;
  role: 'admin' | 'user';
  avatar: string | null;
  cover: string | null;
  planName: string | null;
  /** 'dakyx' when the plan is included with a DakyX retainer rather than bought here. */
  planSource: 'local' | 'dakyx';
  emailVerified: boolean;
};

const AUTH_USER_KEY = 'auth_user';

export function normalizeUser(input: Partial<AppUser> & { id: string; email: string }): AppUser {
  return {
    id: String(input.id),
    name: input.name ?? null,
    email: String(input.email),
    username: input.username ?? null,
    phone: input.phone ?? null,
    country: input.country ?? null,
    website: input.website ?? null,
    role: input.role === 'admin' ? 'admin' : 'user',
    avatar: input.avatar ?? null,
    cover: input.cover ?? null,
    planName: input.planName ?? null,
    planSource: input.planSource === 'dakyx' ? 'dakyx' : 'local',
    emailVerified: input.emailVerified ?? false,
  };
}

export function getStoredUser(): AppUser | null {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AppUser> & { id: string; email: string };
    if (!parsed?.id || !parsed?.email) return null;
    return normalizeUser(parsed);
  } catch {
    return null;
  }
}

export function setStoredUser(user: Partial<AppUser> & { id: string; email: string }) {
  const normalized = normalizeUser(user);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearStoredUser() {
  localStorage.removeItem(AUTH_USER_KEY);
}

function hasValue(value: string | null | undefined) {
  return Boolean(value && value.trim());
}

export function isProfileComplete(user: AppUser | null) {
  if (!user) return false;
  return (
    hasValue(user.name) &&
    hasValue(user.email) &&
    hasValue(user.username) &&
    hasValue(user.phone) &&
    hasValue(user.country)
  );
}
