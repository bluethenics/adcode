"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ModelPrices, type PaidModelPrice } from "./ModelPrices";

interface Wallet {
  availableMicros: number; reservedMicros: number; markupPercent: number; checkoutEnabled: boolean; topupsCents: number[];
  models: PaidModelPrice[];
  orders: { orderId: string; priceCents: number; status: string; createdAt: number }[];
  activity: { id: string; deltaMicros: number; kind: string; model: string; createdAt: number; estimated: boolean }[];
}
const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;

export function ModelWallet({ country }: { country: string }) {
  const { user, token } = useAuth();
  const [wallet,setWallet] = useState<Wallet | null>(null);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  const account = useRef(user?.uid);
  account.current = user?.uid;
  const load = useCallback(async (): Promise<Wallet | null> => {
    const uid = user?.uid;
    if (!uid) return null;
    try {
      const credential=await token();
      if (!credential) throw new Error("Sign in again to view paid credits.");
      const response=await fetch("/v1/ai/wallet",{headers:{authorization:`Bearer ${credential}`},cache:"no-store"});
      if (!response.ok) throw new Error("Could not load paid credits. Please try Refresh.");
      const result=await response.json() as Wallet;
      if (account.current!==uid) return null;
      setWallet(result); setError(""); return result;
    } catch (e) { if (account.current===uid) setError(e instanceof Error?e.message:"Could not load paid credits."); return null; }
  },[user?.uid,token]);
  useEffect(()=>{setWallet(null);setNotice("");setError("");if(user) void load();},[user?.uid,load]);
  useEffect(()=>{
    if (!user) return;
    const order=new URLSearchParams(window.location.search).get("walletOrder");
    if (!order) return;
    let active=true; let timer: ReturnType<typeof setTimeout>;
    const started=Date.now();
    setNotice("Checking your credit payment…");
    const check=async()=>{
      const current=await load(); if (!active) return;
      if (current?.orders.some(o=>o.orderId===order && o.status==="paid")) {
        setNotice("Your paid credits have arrived.");
        const url=new URL(window.location.href); url.searchParams.delete("walletOrder"); window.history.replaceState(null,"",`${url.pathname}${url.search}#wallet`);
      } else if(Date.now()-started<120_000) timer=setTimeout(()=>void check(),3000);
      else setNotice("Payment has not arrived yet. If you paid, press Refresh in a few minutes. Closing checkout does not add credits.");
    };
    void check(); return()=>{active=false;clearTimeout(timer);};
  },[user?.uid,load]);
  const buy=async(priceCents:number)=>{
    if(busy) return; setBusy(true);setError("");const uid=user?.uid;
    try {
      const credential=await token(); if(!credential) throw new Error("Sign in again to buy paid credits.");
      const response=await fetch("/v1/ai/wallet/checkout",{method:"POST",headers:{authorization:`Bearer ${credential}`,"content-type":"application/json"},body:JSON.stringify({priceCents,billingCountry:country.trim().toUpperCase()})});
      const result=await response.json() as {checkoutUrl?:string;error?:{message?:string}};
      if(!response.ok || !result.checkoutUrl) throw new Error(result.error?.message ?? "Checkout could not be opened. Please try again.");
      if(account.current!==uid) return;
      const destination=new URL(result.checkoutUrl); if(destination.protocol!=="https:" || !["checkout.dodopayments.com","test.checkout.dodopayments.com"].includes(destination.hostname)) throw new Error("Checkout returned an invalid address. Please contact support.");
      window.location.assign(destination.href);
    } catch(e) {if(account.current===uid) setError(e instanceof Error?e.message:"Checkout could not be opened.");} finally {if(account.current===uid)setBusy(false);}
  };
  return <section id="wallet" className="ai-tokens-history" aria-labelledby="wallet-title">
    <span className="ai-section-kicker">PAY ONLY FOR WHAT YOU USE</span>
    <h2 id="wallet-title">Paid model credits</h2>
    <p>Use popular models with your ADCode balance. Prices include a 35% markup on provider inference rates. No personal API key or subscription is required.</p>
    <p className="field-hint">These USD credits are separate from included tokens and Heabsy plans. A maximum charge is held during a request; unused credit is released when it finishes. Provider token counts are used when available; an estimated charge is marked in your history.</p>
    {!user && <p>Sign in below to view your balance and available models.</p>}
    {error && <p className="notice" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {user && <button type="button" className="btn btn-outline" onClick={()=>void load()}>Refresh paid credits</button>}
    {wallet && <>
      <div className="stats"><div className="stat"><span className="stat-label">Available paid credits</span><strong className="stat-value">{dollars(wallet.availableMicros)}</strong><span className="stat-hint">USD · no expiry</span></div>{wallet.reservedMicros>0 && <div className="stat"><span className="stat-label">Held for running requests</span><strong className="stat-value">{dollars(wallet.reservedMicros)}</strong></div>}</div>
      <div className="admin-models-actions" style={{display:"flex",flexWrap:"wrap",gap:"0.75rem",marginBlock:"1.25rem"}}>{wallet.topupsCents.map(cents=><button type="button" className="btn btn-outline" key={cents} disabled={busy || !wallet.checkoutEnabled} onClick={()=>void buy(cents)}>Add ${cents/100}</button>)}</div>
      {!wallet.checkoutEnabled && <p className="field-hint">Paid model purchases are not available yet. Your existing credits are unchanged.</p>}
      <ModelPrices models={wallet.models} markupPercent={wallet.markupPercent} />
      {wallet.activity.length>0 && <><h3>Paid credit activity</h3><div className="ai-token-table-scroll" role="region" aria-label="Paid credit activity" tabIndex={0}><table className="table"><thead><tr><th>Date</th><th>Activity</th><th>Amount</th><th>Model</th></tr></thead><tbody>{wallet.activity.slice(0,30).map(a=><tr key={a.id}><td>{new Date(a.createdAt).toLocaleString()}</td><td>{a.kind}{a.estimated?" (estimated)":""}</td><td>{a.deltaMicros>0?"+":"−"}{dollars(Math.abs(a.deltaMicros))}</td><td>{wallet.models.find(m=>m.id===a.model)?.name ?? a.model}</td></tr>)}</tbody></table></div></>}
    </>}
  </section>;
}
