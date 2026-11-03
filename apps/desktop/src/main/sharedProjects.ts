import { join, basename } from "node:path";
import { app, ipcMain, BrowserWindow } from "electron";
import { CHANNELS, type SharedProjectLibrary, type SharedProjectSnapshot, type ProjectChatMessage } from "../shared/api.ts";
import { backendAccount } from "./backend.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { gitForWorkspace } from "./sourceControl.ts";
import { currentWorkspace } from "./workspace.ts";

export const projectServiceOrigin = () => process.env["ADCODE_COLLAB_ORIGIN"] ?? "https://projects.bluethenics.com";
function account() { return backendAccount({ clock: new SystemClock(), http: new FetchHttpTransport([]), store: new DiskFileStore(join(app.getPath("userData"),"ads")) }); }
export async function projectToken(): Promise<string> { const result = await account()?.getToken(); if (!result?.ok) throw new Error("Sign in to use shared projects."); return result.value; }
export async function projectRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(projectServiceOrigin()+path,{ method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${await projectToken()}`, "content-type":"application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
  let result: T & { error?: string; upgrade?: boolean };
  try { result = await response.json() as typeof result; } catch { throw new Error("The shared-project service needs an update. Please try again shortly."); }
  if (!response.ok) throw new Error(result.error ?? "The shared project could not connect.");
  return result;
}
export async function currentRepository(): Promise<string | null> {
  for (const remote of await gitForWorkspace()?.remotes() ?? []) {
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote.url);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}
async function displayName() { const profile = await account()?.profile(); return profile?.ok && profile.value ? profile.value.displayName ?? profile.value.email?.split("@")[0] ?? "Teammate" : "Teammate"; }
export async function createSharedProject(name?: string, chosenName?: string): Promise<SharedProjectSnapshot> {
  const repository = await currentRepository(); if (!repository) throw new Error("Connect the open project's Git repository to GitHub before sharing it.");
  return projectRequest("/projects/create",{ name: name ?? basename(currentWorkspace()?.root ?? repository), repository, displayName: chosenName ?? await displayName() });
}
const projectId = (value: unknown): string => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Choose a shared project."); return value; };
const sessionId = (value: unknown): string => { if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error("Choose a project chat session."); return value; };
let aiReply: ((messages: readonly ProjectChatMessage[], prompt: string) => Promise<string>) | null = null;
export function registerProjectAiReply(handler: NonNullable<typeof aiReply>) { aiReply = handler; }
export function registerSharedProjectsIpc() {
  ipcMain.handle(CHANNELS.sharedProjectLibrary,()=>projectRequest<SharedProjectLibrary>("/projects"));
  ipcMain.handle(CHANNELS.sharedProjectCreate,()=>createSharedProject());
  ipcMain.handle(CHANNELS.sharedProjectJoin,async (_event,invite: unknown)=>{
    if (typeof invite !== "string" || invite.length > 300) throw new Error("Paste a project invite.");
    return projectRequest<SharedProjectSnapshot>("/projects/join",{invite:invite.trim(),displayName:await displayName()});
  });
  ipcMain.handle(CHANNELS.sharedProjectSnapshot,(_event,id:unknown,session:unknown,before:unknown)=>{
    const query = new URLSearchParams(); if (session != null) query.set("session",sessionId(session));
    if (before != null) { if (typeof before!=="number"||!Number.isSafeInteger(before)||before<1) throw new Error("Invalid history cursor."); query.set("before",String(before)); }
    return projectRequest<SharedProjectSnapshot>(`/projects/${projectId(id)}?${query}`);
  });
  ipcMain.handle(CHANNELS.sharedProjectSession,(_event,id:unknown,title:unknown)=>{
    if (typeof title!=="string"||!title.trim()||title.length>100) throw new Error("Give this session a title under 100 characters.");
    return projectRequest<SharedProjectSnapshot>(`/projects/${projectId(id)}/sessions`,{title,id:crypto.randomUUID()});
  });
  ipcMain.handle(CHANNELS.sharedProjectMessage,async (_event,id:unknown,session:unknown,text:unknown,ask:unknown,nonce:unknown)=>{
    const project = projectId(id), chat = sessionId(session);
    if (typeof text!=="string"||!text.trim()||text.length>8000||typeof ask!=="boolean") throw new Error("Write a message under 8,000 characters.");
    if (typeof nonce!=="string"||! /^[a-zA-Z0-9_-]{1,80}$/.test(nonce)) throw new Error("Invalid message identifier.");
    const prior = await projectRequest<SharedProjectSnapshot>(`/projects/${project}?session=${chat}`);
    if (ask && (!aiReply || prior.repository !== await currentRepository())) throw new Error("Open this project's GitHub checkout before asking AI. Team messages do not require a local checkout.");
    const result = await projectRequest<{lease:string|null; snapshot:SharedProjectSnapshot}>(`/projects/${project}/messages`,{sessionId:chat,text,ask,id:nonce});
    if (ask && result.lease && aiReply) {
      const lease = result.lease, run = aiReply;
      void (async()=>{
        const renewal=setInterval(()=>{ void projectRequest(`/projects/${project}/renew`,{sessionId:chat,lease}).catch(()=>{}); },30_000);
        let answer: string, failed = false;
        try { answer = await run(result.snapshot.messages.filter(message=>!(message.id===nonce&&message.authorId===result.snapshot.selfId)),text); } catch(error) { failed = true; answer = error instanceof Error ? error.message : "The assistant could not finish. Please try again."; }
        finally { clearInterval(renewal); }
        // Bound UTF-8 payload size even for replies made entirely of non-Latin text.
        const sharedAnswer=answer.length>30_000?answer.slice(0,30_000)+"\n\n[This long reply was shortened for the shared conversation.]":answer;
        await projectRequest(`/projects/${project}/finish`,{sessionId:chat,lease,text:sharedAnswer||"The assistant returned no text.",failed});
        for(const window of BrowserWindow.getAllWindows()) if(!window.isDestroyed()) window.webContents.send(CHANNELS.sharedProjectChanged,project);
      })().catch(()=>{ /* The server lease expires and another request can then continue. */ });
    }
    return result.snapshot;
  });
  ipcMain.handle(CHANNELS.sharedProjectManage,async (_event,id:unknown,action:unknown,target:unknown)=>{
    const project = projectId(id);
    if(action==="archive"||action==="invite") return projectRequest(`/projects/${project}/${action}`,{});
    if(action==="remove") { if(typeof target!=="string"||!target||target.length>128) throw new Error("Choose a member."); return projectRequest(`/projects/${project}/members`,{uid:target}); }
    throw new Error("Unknown project action.");
  });
}
