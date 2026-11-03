import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AiPlanState } from "@adcode/api/src/aiPlans.ts";
import type { RequestPriority } from "@adcode/api/src/requestPriority.ts";

interface PriorityBinding {
  enter(uid:string,pool:string,plan:AiPlanState["plan"]):Promise<{id?:string;admitted?:boolean;error?:string}>;
  check(uid:string,pool:string,id:string):Promise<{admitted:boolean;expired:boolean}>;
  renew(uid:string,pool:string,id:string):Promise<boolean>;
  release(uid:string,pool:string,id:string):Promise<void>;
}
function wait(ms:number,signal:AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    if(signal.aborted) { reject(new Error("Request cancelled")); return; }
    const abort=()=>{clearTimeout(timer);signal.removeEventListener("abort",abort);reject(new Error("Request cancelled"));};
    const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},ms); signal.addEventListener("abort",abort,{once:true});
  });
}
/** Each lease and its renewal timer belong to one request, including its streaming lifetime. */
export const accountRequestPriority: RequestPriority = {
  async acquire(input) {
    const context=getCloudflareContext();
    const binding=(context.env as typeof context.env & { AI_PRIORITY?:PriorityBinding }).AI_PRIORITY;
    // Allows the API/entrypoint to be deployed before its new service binding, without an outage.
    if(!binding) return {release:async()=>{}};
    const {uid,pool,plan,signal}=input, ticket=await binding.enter(uid,pool,plan);
    if(!ticket.id) throw new Error(ticket.error??"Provider queue full");
    const id=ticket.id;
    try {
      let admitted=ticket.admitted===true;
      const deadline=Date.now()+60_000;
      while(!admitted) {
        if(Date.now()>=deadline) throw new Error("Provider queue timeout");
        await wait(250,signal); const status=await binding.check(uid,pool,id);
        if(status.expired) throw new Error("Provider queue expired"); admitted=status.admitted;
      }
      if(signal.aborted) throw new Error("Request cancelled");
      const lost=new AbortController(); let released:Promise<void>|null=null;
      const release=()=>{ clearInterval(heartbeat); return released??=binding.release(uid,pool,id); };
      const heartbeat=setInterval(()=>{
        void binding.renew(uid,pool,id).then(alive=>{if(!alive){lost.abort();void release().catch(()=>{});}}).catch(()=>{lost.abort();void release().catch(()=>{});});
      },25_000);
      return {release,signal:lost.signal};
    } catch(error) { await binding.release(uid,pool,id).catch(()=>{}); throw error; }
  },
};
