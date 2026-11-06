import { getStoredUser } from '../utils/userSession';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../utils/apiBase';

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type Organization = {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo_url: string | null;
  owner_id: string;
  role: OrgRole;
  member_count: number;
  created_at: string;
};

export type Project = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  color: string;
  created_by_user_id: string | null;
  created_at: string;
};

type WorkspaceContextType = {
  organizations: Organization[];
  currentOrg: Organization | null;
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  switchOrg: (orgId: string) => Promise<void>;
  switchProject: (projectId: string) => void;
  refresh: () => Promise<void>;
  canManage: boolean;
};

const WorkspaceContext = createContext<WorkspaceContextType>({
  organizations: [],
  currentOrg: null,
  projects: [],
  currentProject: null,
  loading: true,
  switchOrg: async () => {},
  switchProject: () => {},
  refresh: async () => {},
  canManage: false,
});

const STORAGE_KEY = 'workspace_state';

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function loadStoredIds(): { orgId: string | null; projectId: string | null } {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${getStoredUser()?.id || 'anonymous'}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { orgId: null, projectId: null };
}

function saveStoredIds(orgId: string | null, projectId: string | null) {
  localStorage.setItem(`${STORAGE_KEY}:${getStoredUser()?.id || 'anonymous'}`, JSON.stringify({ orgId, projectId }));
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const requestVersion=useRef(0);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProjects = useCallback(async (orgId: string, preferredProjectId?: string | null) => {
    const version=++requestVersion.current;
    try {
      const res = await fetch(`${API_BASE_URL}/api/organizations/${orgId}/projects`, { headers: authHeaders() });
      if (!res.ok) { setProjects([]); setCurrentProject(null); return; }
      const data = await res.json();
      if (version!==requestVersion.current) return;
      const list: Project[] = data.projects ?? [];
      setProjects(list);
      const preferred = preferredProjectId ? list.find((p) => p.id === preferredProjectId) : null;
      setCurrentProject(preferred ?? list[0] ?? null);
    } catch {
      setProjects([]);
      setCurrentProject(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) { requestVersion.current++; setOrganizations([]);setCurrentOrg(null);setProjects([]);setCurrentProject(null);setLoading(false);return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/workspace/summary`, { headers: authHeaders() });
      if (!res.ok) { setOrganizations([]); setCurrentOrg(null); setProjects([]); setCurrentProject(null); return; }
      const data = await res.json();
      const orgs: Organization[] = data.organizations ?? [];
      setOrganizations(orgs);
      if (orgs.length === 0) { setCurrentOrg(null); setProjects([]); setCurrentProject(null); return; }
      const stored = loadStoredIds();
      const preferred = stored.orgId ? orgs.find((o) => o.id === stored.orgId) : null;
      const org = preferred ?? orgs[0];
      setCurrentOrg(org);
      await loadProjects(org.id, stored.projectId);
    } catch {
      setOrganizations([]);
    } finally {
      setLoading(false);
    }
  }, [loadProjects]);

  useEffect(() => {
    void refresh();
    const changed=() => { void refresh(); };
    window.addEventListener('auth-changed',changed);
    return () => window.removeEventListener('auth-changed',changed);
  }, [refresh]);

  useEffect(() => {
    if (currentOrg && currentProject) saveStoredIds(currentOrg.id, currentProject.id);
    else if (currentOrg) saveStoredIds(currentOrg.id, null);
  }, [currentOrg, currentProject]);

  const switchOrg = useCallback(async (orgId: string) => {
    const org = organizations.find((o) => o.id === orgId);
    if (!org) return;
    setCurrentOrg(org);
    setCurrentProject(null);
    await loadProjects(org.id);
  }, [organizations, loadProjects]);

  const switchProject = useCallback((projectId: string) => {
    const proj = projects.find((p) => p.id === projectId);
    if (proj) setCurrentProject(proj);
  }, [projects]);

  const canManage = currentOrg !== null && (currentOrg.role === 'owner' || currentOrg.role === 'admin');

  return (
    <WorkspaceContext.Provider value={{ organizations, currentOrg, projects, currentProject, loading, switchOrg, switchProject, refresh, canManage }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
