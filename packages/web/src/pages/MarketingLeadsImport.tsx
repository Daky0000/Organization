// Marketing → Lead Generation → Import a spreadsheet.
//
// The three-step wizard: read the file, correct the plan it proposes, then
// commit. Nothing is written until the last step.

import LeadsModuleHost from '../components/LeadsModuleHost';
import { LeadImport } from '../components/leads';
import type { PageType } from '../App';

export default function MarketingLeadsImport({ navigateToPage }: { navigateToPage: (page: PageType) => void }) {
  return (
    <LeadsModuleHost navigateToPage={navigateToPage}>
      <LeadImport />
    </LeadsModuleHost>
  );
}
