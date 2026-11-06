import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, RefreshCw, ShoppingBag } from 'lucide-react';
import { creditRequest, CreditRequestError, money, type CreditPack, type CreditCatalog, type CreditBalance, type Purchase, type Activity, type SavedCard, type RechargeAgreement, type RechargeAttempt, type Page } from '../services/creditService';

const input='w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-indigo-600';
const button='rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50';
export default function Credits() {
  const [catalog,setCatalog]=useState<CreditCatalog|null>(null);const [balance,setBalance]=useState<CreditBalance|null>(null);
  const [purchases,setPurchases]=useState<Page<Purchase>>({ items:[],nextCursor:null });const [activity,setActivity]=useState<Page<Activity>>({ items:[],nextCursor:null });
  const [methods,setMethods]=useState<SavedCard[]>([]);const [attempts,setAttempts]=useState<RechargeAttempt[]>([]);
  const [agreement,setAgreement]=useState<RechargeAgreement>({ enabled:false,threshold:50,monthly_limit:3 });
  const [packId,setPackId]=useState('starter');const [methodId,setMethodId]=useState('');const [threshold,setThreshold]=useState(50);const [monthlyLimit,setMonthlyLimit]=useState(3);
  const [consent,setConsent]=useState(false);const [saveCard,setSaveCard]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState('');const guard=useRef(false);const mounted=useRef(true);
  async function load() {
    const [nextCatalog,nextBalance,nextPurchases,nextActivity,recharge]=await Promise.all([
      creditRequest<CreditCatalog>('/credits/packs'),creditRequest<CreditBalance>('/credits/balance'),creditRequest<Page<Purchase>>('/credits/purchases'),creditRequest<Page<Activity>>('/credits/history'),
      creditRequest<{ agreement:RechargeAgreement;attempts:RechargeAttempt[] }>('/credits/auto-recharge'),
    ]);
    if(!mounted.current)return;
    setCatalog(nextCatalog);setBalance(nextBalance);setPurchases(nextPurchases);setActivity(nextActivity);setAgreement(recharge.agreement);setAttempts(recharge.attempts);
    const saved=await creditRequest<{ methods:SavedCard[] }>('/credits/payment-methods').catch(()=>({ methods:[] }));
    if(!mounted.current)return;setMethods(saved.methods);setPackId(recharge.agreement.pack_id || 'starter');setMethodId(recharge.agreement.method_id || saved.methods[0]?.id || '');
    setThreshold(recharge.agreement.threshold);setMonthlyLimit(recharge.agreement.monthly_limit);setConsent(false);
  }
  async function action(id:string,fn:()=>Promise<void>) {
    if(guard.current)return;guard.current=true;setBusy(id);setError('');
    try{await fn();}catch(e){setError(e instanceof Error?e.message:'Operation failed');}finally{guard.current=false;if(mounted.current)setBusy('');}
  }
  async function verify(reference:string) {
    const result=await creditRequest<{ fulfilled:boolean;status:string;mode:string }>(`/payments/paystack/verify/${encodeURIComponent(reference)}`);
    setMessage(result.fulfilled?(result.mode==='test'?'Test payment verified. Sandbox credits updated; live balance unchanged.':'Payment verified. Credits added.'):
      result.status==='failed'?'Payment failed. No credits added.':result.status==='refunded'?'Payment refunded. Purchase credits reversed.':result.status==='abandoned'?'Checkout cancelled. No credits added.':'Payment pending. Check status again; do not start another payment.');
    await load();
  }
  useEffect(()=>{
    mounted.current=true;
    void (async()=>{try{await load();const reference=new URLSearchParams(window.location.search).get('paystack_reference');if(reference)await verify(reference);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Unable to load credits');}finally{if(mounted.current)setLoading(false);}})();
    return()=>{mounted.current=false;};
  },[]);
  const selected=catalog?.packs.find(p=>p.id===packId);
  async function purchase(pack:CreditPack) {
    if(!catalog)return;
    const userId=JSON.parse(localStorage.getItem('auth_user')||'{}').id;
    const storageKey=`credit-purchase:${userId}:${catalog.mode}:${pack.id}`;
    const stored=sessionStorage.getItem(storageKey);
    const intent=stored?JSON.parse(stored):{key:crypto.randomUUID(),body:{packId:pack.id,catalogVersion:catalog.version,saveCard}};
    sessionStorage.setItem(storageKey,JSON.stringify(intent));
    try {
      const result=await creditRequest<{ checkoutUrl:string|null;reference:string }>('/credits/purchase','POST',intent.body,intent.key);
      sessionStorage.removeItem(storageKey);
      if(result.checkoutUrl) window.location.assign(result.checkoutUrl);
      else { setMessage('Checkout is pending. Check this purchase in history before starting another payment.');await load(); }
    } catch(error) {
      if(error instanceof CreditRequestError && [400,403,404,409].includes(error.status))sessionStorage.removeItem(storageKey);
      if(error instanceof CreditRequestError && error.status===409)await load();
      throw error;
    }
  }
  async function receipt(reference:string) {
    const { receipt:r }=await creditRequest<{ receipt:Record<string,any> }>(`/credits/receipts/${encodeURIComponent(reference)}`);
    const text=`Dakyworld credit purchase receipt\n${r.mode==='test'?'SANDBOX — no real payment\n':''}\nReference: ${r.reference}\nPack: ${r.pack_name || r.pack_id}\nCredits: ${r.credits}\nPaid: ${money(r.amount_subunits/100,r.currency)}\nStatus: ${r.status}\nDate: ${new Date(r.paid_at).toLocaleString()}\nCustomer: ${r.customer_email}\n`;
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));const link=document.createElement('a');link.href=url;link.download=`receipt-${reference}.txt`;link.click();URL.revokeObjectURL(url);
  }
  return <main className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold text-slate-900">AI credits</h1><p className="mt-2 text-sm text-slate-600">One-time purchase. Credits never expire. No subscription required.</p><p className="mt-1 text-sm text-slate-500">Your plan still determines which tools and quotas you can access.</p></div>
      <button className={button} disabled={Boolean(busy)} onClick={()=>void action('refresh',load)}><RefreshCw size={14} className="mr-2 inline"/>Refresh</button></header>
    {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertCircle className="mr-2 inline" size={16}/>{error} <button className="ml-2 underline" onClick={()=>void action('retry',load)}>Retry</button></div>}
    {message&&<p role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">{message}</p>}
    {catalog?.mode==='test'&&<p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Test mode. Administrators can test checkout; sandbox credits never change live credits.</p>}
    {loading?<p role="status">Loading credit account…</p>:balance&&<section aria-label="Credit balances" className="grid grid-cols-2 gap-4 border-y border-slate-200 py-5 lg:grid-cols-4">
      {[['Available credits',balance.credits],['Monthly remaining',balance.allowanceRemaining],['Purchased remaining',balance.purchasedCredits],['Reserved for refunds',balance.reservedCredits]].map(([label,value])=><div key={String(label)}><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{Number(value).toLocaleString()}</p></div>)}
      <p className="col-span-2 text-sm text-slate-500 lg:col-span-4">Monthly credits are spent first. {balance.resetDate&&`Allowance resets ${new Date(balance.resetDate).toLocaleDateString()}.`} {balance.spendingBlocked&&'Spending is blocked pending administrator review.'}</p>
    </section>}
    <section aria-labelledby="buy-credits"><h2 id="buy-credits" className="text-lg font-semibold text-slate-900">Buy credits</h2>
      {!loading&&!catalog?.paymentAvailable&&<p className="mt-2 text-sm text-amber-800">Checkout is currently unavailable. Contact support or try again later.</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{catalog?.packs.map(pack=><article key={pack.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5"><h3 className="font-semibold text-slate-900">{pack.name}</h3><p className="mt-4 text-2xl font-bold tabular-nums">{pack.credits.toLocaleString()} <span className="text-sm font-normal text-slate-500">credits</span></p><p className="mt-2 text-lg font-semibold">{pack.amount!==null&&pack.currency?money(pack.amount,pack.currency):money(pack.priceUsd,'USD')}</p><p className="mt-3 flex-1 text-sm text-slate-500">{pack.description}</p><button className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50" disabled={!catalog.paymentAvailable||Boolean(busy)} onClick={()=>void action(pack.id,()=>purchase(pack))}><ShoppingBag size={15}/>{busy===pack.id?'Opening checkout…':`Buy ${pack.name}`}</button></article>)}</div>
      <label className="mt-4 flex items-start gap-3 text-sm text-slate-600"><input className="mt-1" type="checkbox" checked={saveCard} onChange={e=>setSaveCard(e.target.checked)}/>Save my card for optional auto-recharge. This limits checkout to cards; automatic charges require separate consent.</label>
    </section>
    <section aria-labelledby="auto-recharge" className="border-t border-slate-200 pt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="auto-recharge" className="text-lg font-semibold">Automatic recharge</h2><span className="text-sm text-slate-500">{agreement.enabled?'Enabled':'Off'}</span></div>
      <p className="mt-2 text-sm text-slate-600">Requires a reusable saved card. At most one automatic charge every 24 hours. A submitted charge may settle after you disable recharge.</p>
      {agreement.pause_reason&&<p role="status" className="mt-2 text-sm text-amber-800">{agreement.pause_reason}</p>}
      {!catalog?.rechargeAvailable&&<p className="mt-2 text-sm text-slate-500">Automatic recharge is not enabled for this payment mode.</p>}
      <form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();void action('recharge',async()=>{await creditRequest('/credits/auto-recharge','PUT',{enabled:true,packId,methodId,threshold,monthlyLimit,catalogVersion:catalog?.version,consent:true});setMessage('Automatic recharge enabled.');await load();});}}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="space-y-2 text-sm">Pack<select className={input} value={packId} onChange={e=>{setPackId(e.target.value);setConsent(false);}}>{catalog?.packs.map(p=><option key={p.id} value={p.id}>{p.name} — {p.credits.toLocaleString()} credits</option>)}</select></label>
          <label className="space-y-2 text-sm">Saved card<select className={input} value={methodId} onChange={e=>{setMethodId(e.target.value);setConsent(false);}}><option value="">Choose a card</option>{methods.map(m=><option key={m.id} value={m.id}>{m.brand} ending {m.last4}</option>)}</select></label>
          <label className="space-y-2 text-sm">Recharge below<input className={input} type="number" min={1} max={(selected?.credits||1000)-1} value={threshold} onChange={e=>{setThreshold(Number(e.target.value));setConsent(false);}} required/></label>
          <label className="space-y-2 text-sm">Monthly purchase limit<input className={input} type="number" min={1} max={10} value={monthlyLimit} onChange={e=>{setMonthlyLimit(Number(e.target.value));setConsent(false);}} required/></label></div>
        {selected?.amount!=null&&selected.currency&&<p className="text-sm font-medium">Each recharge: {money(selected.amount,selected.currency)}. Maximum monthly spend: {money(selected.amount*monthlyLimit,selected.currency)}.</p>}
        <label className="flex items-start gap-3 text-sm text-slate-600"><input type="checkbox" className="mt-1" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I authorize the selected card to be charged for this pack below my threshold, within these limits. Pricing changes require renewed consent.</label>
        <div className="flex flex-wrap gap-3"><button className={button} disabled={!consent||!methodId||!catalog?.rechargeAvailable||Boolean(busy)} type="submit">{agreement.enabled?'Update recharge':'Enable recharge'}</button>{agreement.enabled&&<button className={button} type="button" disabled={Boolean(busy)} onClick={()=>void action('disable',async()=>{await creditRequest('/credits/auto-recharge','PUT',{enabled:false});await load();setMessage('Recharge disabled. A submitted charge may still settle.');})}>Disable recharge</button>}</div>
      </form>
      <div className="mt-5 space-y-3">{methods.map(m=><div key={m.id} className="flex flex-wrap justify-between gap-3 border-b border-slate-100 pb-3 text-sm"><span>{m.brand} ending {m.last4} · expires {m.exp_month}/{m.exp_year}</span><button className="text-red-700 underline" disabled={Boolean(busy)} onClick={()=>void action(m.id,async()=>{await creditRequest(`/credits/payment-methods/${m.id}`,'DELETE');await load();})}>Remove card</button></div>)}</div>
      {attempts.length>0&&<details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Recent recharge attempts</summary><ul className="mt-3 space-y-2">{attempts.map(a=><li key={a.id}>{new Date(a.created_at).toLocaleString()} — {a.status}{a.last_error?` · ${a.last_error}`:''}</li>)}</ul></details>}
    </section>
    <section aria-labelledby="purchase-history" className="border-t border-slate-200 pt-6"><h2 id="purchase-history" className="text-lg font-semibold">Purchase history</h2>{!purchases.items.length&&!loading&&<p className="mt-3 text-sm text-slate-500">No credit purchases yet.</p>}
      <ul className="mt-4 divide-y divide-slate-200">{purchases.items.map(p=><li key={p.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="font-medium">{p.pack_name||'Credit pack'} · {p.credits.toLocaleString()} credits</p><p className="mt-1 text-sm text-slate-500">{money(p.amount,p.currency)} · {p.refund_status?`Refund ${p.refund_status}`:p.status} · {new Date(p.created_at).toLocaleDateString()}</p><p className="mt-1 break-all text-xs text-slate-400">{p.reference}</p></div><div className="flex gap-2">{!p.fulfilled_at&&<button className={button} disabled={Boolean(busy)} onClick={()=>void action(p.id,()=>verify(p.reference))}>Check payment status</button>}{p.fulfilled_at&&<button className={button} disabled={Boolean(busy)} onClick={()=>void action(p.id,()=>receipt(p.reference))}>Receipt</button>}</div></li>)}</ul>
      {purchases.nextCursor&&<button className={button} disabled={Boolean(busy)} onClick={()=>void action('more-purchases',async()=>{const result=await creditRequest<Page<Purchase>>(`/credits/purchases?cursor=${encodeURIComponent(purchases.nextCursor!)}`);setPurchases({items:[...purchases.items,...result.items],nextCursor:result.nextCursor});})}>More purchases <ArrowRight size={13} className="inline"/></button>}
    </section>
    <section aria-labelledby="credit-activity" className="border-t border-slate-200 pt-6"><h2 id="credit-activity" className="text-lg font-semibold">Credit activity</h2>{!activity.items.length&&!loading&&<p className="mt-3 text-sm text-slate-500">Credit activity appears after purchases and usage.</p>}<ul className="mt-4 divide-y divide-slate-100">{activity.items.map(a=><li key={a.id} className="flex justify-between gap-4 py-3 text-sm"><div><p className="capitalize">{a.reason.replace(/_/g,' ')}</p><p className="mt-1 text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</p></div><p className="text-right tabular-nums">{a.delta>0?'+':''}{a.delta.toLocaleString()}<span className="block text-xs text-slate-500">Balance {a.balance_after.toLocaleString()}</span></p></li>)}</ul>
      {activity.nextCursor&&<button className={button} disabled={Boolean(busy)} onClick={()=>void action('more-activity',async()=>{const result=await creditRequest<Page<Activity>>(`/credits/history?cursor=${encodeURIComponent(activity.nextCursor!)}`);setActivity({items:[...activity.items,...result.items],nextCursor:result.nextCursor});})}>More activity</button>}
    </section>
  </main>;
}
