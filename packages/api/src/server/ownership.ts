import type { Pool } from 'pg';

const references = { stage_id: 'crm_pipeline_stages', contact_id: 'mailing_contacts', company_id: 'crm_companies' } as const;
export async function ownedCrmReferences(pool: Pool,userId: string,body: Record<string,unknown>): Promise<boolean> {
  for (const [field,table] of Object.entries(references)) {
    const value=body[field]; if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') return false;
    const result=await pool.query(`SELECT id FROM ${table} WHERE id=$1 AND user_id=$2`,[value,userId]);
    if (!result.rows.length) return false;
  }
  return true;
}
