// Marketing → Lead Generation. The pipeline table.
//
// The page itself is the vendored module's; everything host-specific — the API
// base, the query client, SPA link handling — lives in LeadsModuleHost.

import LeadsModuleHost from '../components/LeadsModuleHost';
import { Leads } from '../components/leads';
import type { PageType } from '../App';

export default function MarketingLeads({ navigateToPage }: { navigateToPage: (page: PageType) => void }) {
  return (
    <LeadsModuleHost navigateToPage={navigateToPage}>
      <Leads
        title="Lead Generation"
        subtitle="Every prospect from first contact through close."
        canImport
      />
    </LeadsModuleHost>
  );
}
