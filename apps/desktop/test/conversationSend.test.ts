import {afterEach,describe,expect,it,vi} from "vitest";
import {sendWhenConversationIdle} from "../src/renderer/ai/conversationSend.ts";
describe("conversation recovery sends",()=>{
 const setup=()=>{
  let runs:readonly {sessionId:string}[]=[{sessionId:"chat"}];const listeners=new Set<(runs:readonly {sessionId:string}[])=>void>();
  const send=vi.fn(async()=>true),controller=new AbortController();let current=true;
  const options={sessionId:"chat",runs:vi.fn(async()=>runs),subscribe:(fn:(runs:readonly {sessionId:string}[])=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},send,signal:controller.signal,current:()=>current};
  return {options,send,controller,listeners,change:(next:typeof runs)=>{runs=next;listeners.forEach(fn=>fn(runs));},leave:()=>{current=false;}};
 };
 afterEach(()=>vi.useRealTimers());
 it("waits for run cleanup without repeatedly submitting rejected IPC calls",async()=>{
  const s=setup(),done=sendWhenConversationIdle(s.options);await Promise.resolve();expect(s.send).not.toHaveBeenCalled();s.change([]);expect(await done).toBe(true);expect(s.send).toHaveBeenCalledTimes(1);expect(s.listeners.size).toBe(0);
 });
 it("lets a newer end event win over an older initial snapshot",async()=>{
  const s=setup();let resolve!: (runs:readonly {sessionId:string}[])=>void;s.options.runs=vi.fn(()=>new Promise(r=>{resolve=r;}));
  const done=sendWhenConversationIdle(s.options);s.change([]);resolve([{sessionId:"chat"}]);expect(await done).toBe(true);expect(s.send).toHaveBeenCalledTimes(1);
 });
 it("cancels pending recovery without sending or leaking listeners",async()=>{
  const s=setup(),done=sendWhenConversationIdle(s.options);s.controller.abort();expect(await done).toBe(false);expect(s.send).not.toHaveBeenCalled();expect(s.listeners.size).toBe(0);
 });
 it("does not move a pending message to another conversation",async()=>{
  const s=setup(),done=sendWhenConversationIdle(s.options);s.leave();s.change([]);expect(await done).toBe(false);expect(s.send).not.toHaveBeenCalled();
 });
 it("surfaces a stuck cleanup instead of leaving the composer in stop mode forever",async()=>{
  vi.useFakeTimers();const s=setup();const done=sendWhenConversationIdle({...s.options,timeoutMs:1000});const rejected=expect(done).rejects.toThrow("previous AI turn is still finishing");await vi.advanceTimersByTimeAsync(1001);await rejected;expect(s.listeners.size).toBe(0);
 });
 it("does not swallow real send failures",async()=>{
  const s=setup();s.change([]);s.send.mockRejectedValueOnce(new Error("Account connection failed"));await expect(sendWhenConversationIdle(s.options)).rejects.toThrow("Account connection failed");
 });
});
