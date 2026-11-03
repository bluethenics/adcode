import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { QUEUED_PER_ACCOUNT, QUEUE_SLOTS, REQUEST_PRIORITY, requestTier, ticketsToAdmit } from "../../../services/api/src/requestPriority.ts";
import type { AiPlanState } from "../../../services/api/src/aiPlans.ts";

type Ticket={ id:string; uid:string; rank:number; created:number; expires:number; active:number; planEnds:number };
/** A bounded queue per provider. Aging promotes every waiting tier, with no preemption. */
export class PriorityQueue extends DurableObject<CollabRelayEnv> {
  constructor(ctx:DurableObjectState,env:CollabRelayEnv) {
    super(ctx,env); this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,uid TEXT,rank INTEGER,created INTEGER,expires INTEGER,active INTEGER,planEnds INTEGER)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS queue_order ON tickets(active,created)");
  }
  private drain() {
    const now=Date.now(); this.ctx.storage.sql.exec("DELETE FROM tickets WHERE expires<=?",now);
    this.ctx.storage.sql.exec("UPDATE tickets SET rank=0 WHERE planEnds<=?",now);
    const running=this.ctx.storage.sql.exec<{uid:string;n:number}>("SELECT uid, COUNT(*) n FROM tickets WHERE active=1 GROUP BY uid").toArray();
    const slots=Math.max(0,QUEUE_SLOTS-running.reduce((sum,row)=>sum+row.n,0));
    if(slots===0) return;
    // An account at its own running limit waits in place; the next account's request takes the slot.
    const waiting=this.ctx.storage.sql.exec<Ticket>("SELECT * FROM tickets WHERE active=0 ORDER BY created-rank*2000 ASC, id ASC LIMIT 256").toArray();
    for(const id of ticketsToAdmit(waiting,new Map(running.map(row=>[row.uid,row.n])),slots)) this.ctx.storage.sql.exec("UPDATE tickets SET active=1,expires=? WHERE id=?",now+90_000,id);
  }
  enter(uid:string,plan:AiPlanState["plan"]) {
    return this.ctx.storage.transactionSync(()=>{
      this.drain();
      const count=this.ctx.storage.sql.exec<{n:number}>("SELECT COUNT(*) n FROM tickets").one().n;
      if(count>=256) return {error:"The provider queue is full. Please try again shortly."};
      const tier=requestTier({plan},Date.now());
      // Extra requests wait for one of the account's own to finish; only a pile-up is refused.
      if(this.ctx.storage.sql.exec<{n:number}>("SELECT COUNT(*) n FROM tickets WHERE uid=?",uid).one().n>=QUEUED_PER_ACCOUNT) return {error:"Your account already has several requests in progress. Please wait for one to finish."};
      const id=crypto.randomUUID();
      this.ctx.storage.sql.exec("INSERT INTO tickets VALUES(?,?,?,?,?,0,?)",id,uid,REQUEST_PRIORITY[tier],Date.now(),Date.now()+90_000,plan?.endsAt??0);
      this.drain(); return {id,admitted:this.ctx.storage.sql.exec<Ticket>("SELECT * FROM tickets WHERE id=?",id).one().active===1,tier};
    });
  }
  check(uid:string,id:string) {
    this.drain(); const ticket=this.ctx.storage.sql.exec<Ticket>("SELECT * FROM tickets WHERE id=? AND uid=?",id,uid).toArray()[0];
    return {admitted:ticket?.active===1,expired:!ticket};
  }
  renew(uid:string,id:string) {
    this.drain(); const ticket=this.ctx.storage.sql.exec<Ticket>("SELECT * FROM tickets WHERE id=? AND uid=? AND active=1",id,uid).toArray()[0];
    if(!ticket) return false;
    this.ctx.storage.sql.exec("UPDATE tickets SET expires=? WHERE id=?",Date.now()+90_000,id); return true;
  }
  release(uid:string,id:string) { this.ctx.storage.transactionSync(()=>{ this.ctx.storage.sql.exec("DELETE FROM tickets WHERE id=? AND uid=?",id,uid); this.drain(); }); }
}
/** Private RPC entrypoint, bound only by the authenticated AI API Worker. */
export class RequestPriority extends WorkerEntrypoint<CollabRelayEnv> {
  private providerQueue(pool:string) { if(!/^[a-z0-9_-]{1,80}$/.test(pool)) throw new Error("Invalid provider queue."); return this.env.REQUEST_QUEUES.getByName(pool); }
  enter(uid:string,pool:string,plan:AiPlanState["plan"]) { if(!uid||uid.length>128) throw new Error("Invalid account."); return this.providerQueue(pool).enter(uid,plan); }
  check(uid:string,pool:string,id:string) { return this.providerQueue(pool).check(uid,id); }
  renew(uid:string,pool:string,id:string) { return this.providerQueue(pool).renew(uid,id); }
  release(uid:string,pool:string,id:string) { return this.providerQueue(pool).release(uid,id); }
}
