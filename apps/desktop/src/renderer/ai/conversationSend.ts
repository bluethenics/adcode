interface Run { readonly sessionId: string }
interface IdleSendOptions {
  sessionId: string | null;
  runs(): Promise<readonly Run[]>;
  subscribe(listener: (runs: readonly Run[]) => void): () => void;
  send(): Promise<boolean>;
  current(): boolean;
  signal: AbortSignal;
  waiting?(): void;
  sending?(): void;
  timeoutMs?: number;
}

/** Wait for the previous turn's cleanup instead of repeatedly sending IPC requests it rejects. */
export async function sendWhenConversationIdle(options: IdleSendOptions): Promise<boolean> {
  const deadline=Date.now()+(options.timeoutMs ?? 30_000);
  const wait=()=>new Promise<boolean>((resolve,reject)=>{
    options.waiting?.();
    if(options.signal.aborted||!options.current()){resolve(false);return;}
    if(options.sessionId===null){resolve(true);return;}
    let finished=false,eventSeen=false;let unsubscribe=()=>{};
    const finish=(ready:boolean,error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);unsubscribe();options.signal.removeEventListener("abort",cancel);if(error)reject(error);else resolve(ready);};
    const cancel=()=>finish(false);
    const inspect=(runs:readonly Run[])=>{if(options.signal.aborted||!options.current())finish(false);else if(!runs.some(run=>run.sessionId===options.sessionId))finish(true);};
    const timer=setTimeout(()=>finish(false,new Error("The previous AI turn is still finishing. Your message is kept. Try again shortly.")),Math.max(1,deadline-Date.now()));
    options.signal.addEventListener("abort",cancel,{once:true});
    unsubscribe=options.subscribe(runs=>{eventSeen=true;inspect(runs);});
    if(finished)unsubscribe();
    // A notification can arrive before the initial snapshot; the newer event wins.
    void options.runs().then(runs=>{if(!eventSeen)inspect(runs);},error=>finish(false,error instanceof Error?error:new Error(String(error))));
    if(options.signal.aborted)cancel();
  });
  for(let attempts=0;attempts<3;attempts++){
    if(!await wait()||options.signal.aborted||!options.current())return false;
    try{options.sending?.();return await options.send();}
    catch(error){if(!/already handling/i.test(String(error))||attempts===2||Date.now()>=deadline)throw error;}
  }
  return false;
}
