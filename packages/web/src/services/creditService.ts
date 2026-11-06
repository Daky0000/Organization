import { API_BASE_URL } from '../utils/apiBase';
export interface CreditPack { id:string;name:string;description:string;credits:number;priceUsd:number;amount:number|null;currency:string|null;active:boolean;displayOrder:number }
export interface CreditCatalog { version:string;mode:'test'|'live';currency:string|null;paymentAvailable:boolean;rechargeAvailable:boolean;refundsAvailable:boolean;packs:CreditPack[] }
export interface CreditBalance { credits:number;totalCredits:number;allowanceRemaining:number;purchasedCredits:number;reservedCredits:number;resetDate:string|null;mode:'test'|'live';spendingBlocked:boolean }
export interface Purchase { id:string;reference:string;pack_name:string;credits:number;amount:number;currency:string;mode:string;status:string;fulfilled_at:string|null;refund_status:string|null;created_at:string }
export interface Activity { id:string;delta:number;balance_after:number;reason:string;created_at:string }
export interface SavedCard { id:string;brand:string;last4:string;exp_month:string;exp_year:string }
export interface RechargeAgreement { enabled:boolean;pack_id?:string;method_id?:string;threshold:number;monthly_limit:number;pause_reason?:string }
export interface RechargeAttempt { id:string;status:string;created_at:string;last_error?:string }
export interface Page<T> { items:T[];nextCursor:string|null }
export class CreditRequestError extends Error {
  constructor(message:string,public status:number){super(message);}
}
export async function creditRequest<T>(path:string,method='GET',body?:unknown,key?:string):Promise<T> {
  const response=await fetch(`${API_BASE_URL}/api${path}`,{ method,headers:{ Authorization:`Bearer ${localStorage.getItem('auth_token')||''}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{}) },...(body!==undefined?{ body:JSON.stringify(body) }:{}) });
  const data=await response.json();
  if(!response.ok || data.success===false)throw new CreditRequestError(data.error || 'Credit service unavailable. Please retry.',response.status);
  return data;
}
export const money=(amount:number,currency:string)=>new Intl.NumberFormat(undefined,{style:'currency',currency}).format(Number(amount));
