/**
 * Host-supplied settings for the lead UI.
 *
 * Everything here has a working default, so `<Leads />` renders without any
 * setup at all. Call `configureLeadsUi` once at app start to change where the
 * API lives, what currency amounts read in, or where the module's own links
 * point inside your router.
 */

export interface LeadsUiConfig {
  /** Prefix for every request the module makes. */
  apiBase: string;
  /** Path the leads API is mounted at, relative to `apiBase`. */
  leadsPath: string;
  /** Path the imports API is mounted at, relative to `apiBase`. */
  importsPath: string;
  /** ISO code used to format money. */
  currency: string;
  /** Where the module's own pages live in your router, for its internal links. */
  routes: {
    leads: string;
    leadImport: string;
  };
}

const defaults: LeadsUiConfig = {
  apiBase: "/api",
  leadsPath: "/leads",
  importsPath: "/imports",
  currency: "USD",
  routes: {
    leads: "/leads",
    leadImport: "/leads/import",
  },
};

let current: LeadsUiConfig = defaults;

export function configureLeadsUi(config: Partial<LeadsUiConfig>): void {
  current = { ...defaults, ...config, routes: { ...defaults.routes, ...config.routes } };
}

export function leadsUi(): LeadsUiConfig {
  return current;
}

/** Absolute URL for a leads endpoint — used by the export links, which are plain `<a href>`s. */
export function leadsUrl(path: string): string {
  return `${current.apiBase}${current.leadsPath}${path}`;
}
