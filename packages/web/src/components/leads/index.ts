/**
 * The lead UI.
 *
 * Source files, not a build — the host app compiles them with its own React,
 * its own Tailwind and its own bundler, which is the only way the components
 * can share a React instance and a class layer with the app around them.
 *
 *   import { Leads, LeadImport, configureLeadsUi } from "leads-module/client";
 *   import "leads-module/client/leads.css";
 *
 * Requirements: React 18+, @tanstack/react-query 5 (with a QueryClientProvider
 * somewhere above these pages), and Tailwind — see client/tailwind-preset.cjs.
 */

export { configureLeadsUi, leadsUi, leadsUrl, type LeadsUiConfig } from "./lib/config";
export { ApiError, api, imports, leads, setUnauthorizedHandler } from "./lib/api";
export { useUrlParam } from "./lib/useUrlParam";

export * from "./lib/types";

export { Leads, type LeadsPageProps } from "./pages/Leads";
export { LeadImport } from "./pages/LeadImport";

export { LeadDrawer } from "./components/LeadDrawer";
export {
  ColumnManager,
  FIELD_TYPES,
  LeadCell,
  LeadCellEditor,
  SOURCES,
  STATUSES,
  buildLeadPatch,
  editableText,
  isEditableField,
  leadValue,
  useLeadFields,
  visibleFields,
} from "./components/LeadColumns";

export {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorNote,
  Field,
  LinkButton,
  Money,
  PageHeader,
  RelativeTime,
  ScoreBar,
  StatTile,
  StatusDot,
} from "./components/ui";
