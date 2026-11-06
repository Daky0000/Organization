/**
 * Host shell for the vendored lead-generation UI (src/components/leads).
 *
 * The module is deliberately router-agnostic: it links between its two pages
 * with plain `<a href>` and keeps the open lead in the query string via the
 * History API. That works under any router — but under this app's pushState
 * SPA a bare anchor would trigger a full page reload, so the clicks are
 * intercepted here and turned into `navigateToPage` calls. The module's own
 * source stays untouched.
 *
 * Also supplies the two things it requires from a host: a react-query provider,
 * and `configureLeadsUi` telling it where its API lives.
 */

import { useCallback, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configureLeadsUi, setUnauthorizedHandler } from './leads';
import { API_BASE_URL } from '../utils/apiBase';
import type { PageType } from '../App';

export const LEADS_PATH = '/marketing/leads';
export const LEADS_IMPORT_PATH = '/marketing/leads/import';

// Mounted at /api/leadgen rather than /api/leads: the latter already belongs to
// the Contacts feature's lead groups.
configureLeadsUi({
  apiBase: `${API_BASE_URL}/api/leadgen`,
  leadsPath: '/leads',
  importsPath: '/imports',
  currency: 'USD',
  routes: { leads: LEADS_PATH, leadImport: LEADS_IMPORT_PATH },
});

// The app's global fetch interceptor already logs out on any /api/ 401, so this
// only has to stop the module from rendering an error over a dead session.
setUnauthorizedHandler(() => undefined);

// One client for the whole module. Leads are edited in place and refetched by
// key after every mutation, so the default staleness is fine; retrying a failed
// query three times only delays the error the page is designed to show.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export default function LeadsModuleHost({
  navigateToPage,
  children,
}: {
  navigateToPage: (page: PageType) => void;
  children: ReactNode;
}) {
  const interceptLinks = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Let modified clicks (new tab, download, …) behave normally.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = (event.target as HTMLElement).closest('a');
      const href = anchor?.getAttribute('href');
      if (!href) return;
      if (href !== LEADS_PATH && href !== LEADS_IMPORT_PATH) return;

      event.preventDefault();
      navigateToPage(href === LEADS_IMPORT_PATH ? 'marketing-leads-import' : 'marketing-leads');
    },
    [navigateToPage],
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div onClick={interceptLinks}>{children}</div>
    </QueryClientProvider>
  );
}
