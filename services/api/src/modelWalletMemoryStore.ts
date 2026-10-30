import { randomUUID } from "node:crypto";
import type { WalletStore, WalletView, WalletEvent } from "./modelWallet.ts";

export function createModelWalletMemoryStore(): WalletStore {
  const balances = new Map<string, number>();
  const orders = new Map<string, { orderId: string; uid: string; priceCents: number; status: string; createdAt: number; session: string | null; payment: string | null; refunded: number; disputed: number; gross: number }>();
  const holds = new Map<string, { uid: string; model: string; amount: number; createdAt: number; done: boolean }>();
  const seen = new Set<string>();
  const pending = new Map<string,WalletEvent>();
  const activity: (WalletView["activity"][number] & { uid: string })[] = [];
  const held = (uid: string) => [...holds.values()].filter(h => h.uid === uid && !h.done).reduce((n,h) => n + h.amount,0);
  const expire = (uid: string, now: number) => { for (const h of holds.values()) if (h.uid === uid && !h.done && h.createdAt < now - 1_800_000) h.done = true; };
  const move = (uid: string, delta: number, kind: string, model: string, now: number, estimated = false) => { balances.set(uid,(balances.get(uid) ?? 0) + delta); activity.unshift({ id:randomUUID(),uid,deltaMicros:delta,kind,model,createdAt:now,estimated }); };
  const store: WalletStore = {
    async getModelWallet(uid, now) {
      expire(uid,now); const balanceMicros=balances.get(uid) ?? 0; const reservedMicros=held(uid);
      return { balanceMicros,reservedMicros,availableMicros:Math.max(0,balanceMicros-reservedMicros),orders:[...orders.values()].filter(o=>o.uid===uid).map(({orderId,priceCents,status,createdAt})=>({orderId,priceCents,status,createdAt})),activity:activity.filter(a=>a.uid===uid).slice(0,100).map(({uid:_,...a})=>a) };
    },
    async createWalletOrder(order) {
      if (orders.has(order.orderId) || [...orders.values()].filter(o=>o.uid===order.uid && o.createdAt > order.createdAt-600_000).length >= 5) return false;
      orders.set(order.orderId,{...order,status:"pending",session:null,payment:null,refunded:0,disputed:0,gross:0}); return true;
    },
    async completeWalletOrder(id, session) { const order=orders.get(id); if (order?.status==="pending") order.session=session; },
    async applyWalletEvent(e) {
      const order = e.type === "purchase" ? orders.get(e.orderId ?? "") : [...orders.values()].find(o=>o.payment===e.paymentId);
      if (!order) {if(e.type!=="purchase") pending.set(e.webhookId,e);return "not-ai-tokens";}
      if (seen.has(e.webhookId)) return "duplicate";
      seen.add(e.webhookId);
      const total=order.priceCents*10_000;
      if (e.type==="purchase") {
        if (order.status!=="pending") return order.payment===e.paymentId ? "duplicate" : "review";
        if (Number(e.amountMicros-(e.taxMicros ?? 0n))!==total || order.session===null || order.session!==e.sessionId || [...orders.values()].some(o=>o.payment===e.paymentId)) return "review";
        order.status="paid"; order.payment=e.paymentId; order.gross=Number(e.amountMicros); move(order.uid,total,"purchase","",e.now); for(const queued of [...pending.values()].filter(q=>q.paymentId===e.paymentId)){pending.delete(queued.webhookId);await store.applyWalletEvent(queued);} return "credited";
      }
      if (e.type==="dispute-release") { if (order.status!=="disputed") return "duplicate"; move(order.uid,order.disputed,"dispute-release","",e.now); order.disputed=0; order.status=order.refunded===total?"refunded":"paid"; return "credited"; }
      if (e.type==="dispute-opened") { if (order.status==="disputed" || e.webhookId.startsWith("wallet-dispute-opened:") && seen.has(e.webhookId.replace("wallet-dispute-opened:","wallet-dispute-release:"))) return "duplicate"; order.disputed=Math.max(0,total-order.refunded); order.status="disputed"; move(order.uid,-order.disputed,"dispute","",e.now); return "refunded"; }
      if (order.status==="disputed") return "review";
      const delta=Math.min(Math.ceil(Number(e.amountMicros)*total/(order.gross || total)),total-order.refunded); if (delta<=0) return "duplicate";
      order.refunded+=delta; order.status=order.refunded===total?"refunded":"paid"; move(order.uid,-delta,"refund","",e.now); return "refunded";
    },
    async reserveModelWallet(id, uid, model, amount, now) {
      expire(uid,now); if (holds.has(id)) return false;
      if (!Number.isSafeInteger(amount) || amount<=0 || (balances.get(uid) ?? 0)-held(uid)<amount) return false;
      holds.set(id,{uid,model,amount,createdAt:now,done:false}); return true;
    },
    async settleModelWallet(id, micros, estimated, now) { const h=holds.get(id); if (!h || h.done) return; h.done=true; const used=Math.max(0,Math.min(h.amount,micros)); if (used>0) move(h.uid,-used,"usage",h.model,now,estimated); },
  };
  return store;
}
