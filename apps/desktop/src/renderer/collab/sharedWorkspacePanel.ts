import { renderChatMessageHtml } from "../ai/chatMarkdown.ts";
import { Plus, Send, Sparkles, Users, Link2, Copy, FolderOpen, ArrowUpRight, Archive, LogOut, MessageSquare, ChevronRight } from "lucide";
import type { ProjectChatMessage, SharedProjectLibrary, SharedProjectSnapshot } from "../../shared/api.ts";
import { createFloatingPanel } from "../workbench/floatingPanel.ts";
import { ICON, iconButton, createIcon } from "../workbench/icons.ts";
import { BUY_TOKENS_URL } from "../../shared/tagflow.ts";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function button(label: string, action: () => void, primary = false) {
  const node = element("button",label,`projects-button ${primary ? "projects-button-primary" : "projects-button-secondary"}`); node.type = "button"; node.title = label; node.setAttribute("aria-label", label); const icon = /Send/.test(label) ? Send : /Ask AI/.test(label) ? Sparkles : /New|Share current/.test(label) ? Plus : /Copy/.test(label) ? Copy : /invite|Join/.test(label) ? Link2 : /Archive/.test(label) ? Archive : /Leave/.test(label) ? LogOut : /Local/.test(label) ? FolderOpen : /Upgrade/.test(label) ? ArrowUpRight : Users; const caption = element("span", label, "shared-action-label"); node.replaceChildren(createIcon(icon), caption); node.addEventListener("click",action); return node;
}
export function createSharedWorkspacePanel(deps: {
  prompt: (title: string, detail: string, value: string) => Promise<string | null>;
  confirm: (title: string, detail: string, label: string) => Promise<boolean>;
  signIn: () => void;
  openLocalProjects: () => void;
}) {
  const content = element("div","","shared-workspace"), sidebar = element("aside","","shared-library");
  const libraryHeader = element("div","","projects-sidebar-heading"), refresh = iconButton("Refresh shared projects",ICON.reload);
  libraryHeader.append(element("h2","Shared projects"),element("span","Beta","shared-beta"),refresh);
  const quota = element("p","Checking your plan…","projects-muted"), list = element("div","","shared-project-list");
  const share = button("Share current project",()=>{ void task(async()=>{ const snapshot = await window.adcode.collab.sharedCreate(); await loadLibrary(); await openProject(snapshot.id); }); },true);
  const join = button("Join a project",()=>{ void task(async()=>{
    const invite = await deps.prompt("Join a shared project","Paste the permanent project invite. You will get access to its shared chat sessions.","");
    if (!invite?.trim()) return; const snapshot = await window.adcode.collab.sharedJoin(invite.trim()); await loadLibrary(); await openProject(snapshot.id);
  }); });
  const upgrade = button("Upgrade plan",()=>{ window.open(`${BUY_TOKENS_URL}#plans`,"_blank","noopener"); });
  const signIn = button("Account",deps.signIn);
  sidebar.append(libraryHeader,quota,share,join,upgrade,list,button("Local projects & Git contributions",deps.openLocalProjects),signIn);
  const main = element("section","","shared-main"), header = element("header","","shared-header"), title = element("h2","Project conversations");
  const projectInfo = element("p","Members share sessions, messages, and AI replies here. Your private chats stay private.","projects-muted");
  const actions = element("div","","projects-actions"); header.append(title,element("span","Beta","shared-beta"),projectInfo,actions);
  const error = element("p","","collab-error"); error.hidden = true; error.setAttribute("role","status");
  const sessions = element("div","","shared-sessions"); sessions.setAttribute("aria-label","Project chat sessions");
  const newSession = button("New session",()=>{ void task(async()=>{
    if (!snapshot) return; apply(await window.adcode.collab.sharedSession(snapshot.id,"New conversation"),true);
  }); });
  const memberDetails = element("details","","shared-member-details"), memberSummary = element("summary","People & contributions"), members = element("div","","shared-members"); memberDetails.append(memberSummary,members);
  const timeline = element("div","","shared-transcript"); timeline.setAttribute("role","log"); timeline.setAttribute("aria-label","Shared project messages"); timeline.setAttribute("aria-live","polite");
  const older = button("Load older messages",()=>{ void task(async()=>{
    if (!snapshot || !messages.length) return; const earlier = await window.adcode.collab.sharedSnapshot(snapshot.id,snapshot.selectedSession,messages[0]!.seq);
    hasOlder = earlier.hasOlder; mergeMessages(earlier.messages); renderMessages(false);
  }); });
  older.hidden = true;
  const composer = element("form","","shared-composer"), input = element("textarea"); input.rows = 3; input.maxLength = 8000; input.placeholder = "Message your project…"; input.setAttribute("aria-label","Message your project");
  const composerActions = element("div","","projects-actions"), send = button("Send to team",()=>{ void post(false); },true), ask = button("Ask AI",()=>{ void post(true); });
  const pending = element("span","","projects-muted"); pending.setAttribute("role","status");
  composerActions.append(send,ask,pending); composer.append(input,composerActions,element("p","AI uses your account's credits and the open project checkout. Its reply is visible to every project member.","projects-footnote"));
  composer.addEventListener("submit",event=>{ event.preventDefault(); void post(false); });
  input.addEventListener("keydown",event=>{ if ((event.ctrlKey||event.metaKey)&&event.key==="Enter") { event.preventDefault(); void post(false); } });
  input.addEventListener("input",()=>{ const key = draftKey(); if(key) drafts.set(key,input.value); nonce = null; });
  main.append(header,error,memberDetails,newSession,sessions,older,timeline,composer); content.append(sidebar,main);
  let library: SharedProjectLibrary | null = null, snapshot: SharedProjectSnapshot | null = null;
  let selected: string | null = null, generation = 0, polling: number | undefined, posting = false, busy = false, nonce: string | null = null;
  let messages: ProjectChatMessage[] = [], hasOlder = false;
  const drafts = new Map<string,string>();
  const panel = createFloatingPanel({ id:"shared-projects", title:"Shared projects & sessions",content,defaultSize:{width:1080,height:760},anchor:"centre",
    onVisibilityChange: open=>{ if(!open) { generation++; clearTimeout(polling); } },
  });
  let integrated: { host: HTMLElement; show: () => void } | null = null;
  let active = false;
  const expandedProjects = new Set<string>();
  const projectSnapshots = new Map<string, SharedProjectSnapshot>();
  const isVisible = () => integrated ? active : panel.isOpen();
  function reveal() { if (integrated) { active = true; integrated.host.hidden = false; integrated.show(); } else panel.open(); }
  function draftKey() { return snapshot?.selectedSession ? `${snapshot.id}:${snapshot.selectedSession}` : null; }
  function showError(message: string) { error.textContent = message; error.hidden = !message; }
  async function task(work:()=>Promise<void>) {
    if(busy) return; busy=true; generation++; clearTimeout(polling); share.disabled=true; join.disabled=true; refresh.disabled=true; showError("");
    try { await work(); } catch(error) { showError(error instanceof Error ? error.message : "The shared project could not connect."); }
    finally { busy=false; share.disabled=false; join.disabled=false; refresh.disabled=false; schedule(); }
  }
  function renderLibrary() {
    const activeElement=document.activeElement;
    const focused=activeElement instanceof HTMLElement && list.contains(activeElement) ? {project:activeElement.dataset["project"],session:activeElement.dataset["session"],tag:activeElement.tagName} : null;
    list.replaceChildren();
    if (!library) return;
    quota.textContent = `${library.limits.plan === "free" ? "Free" : library.limits.plan} · ${library.owned}/${library.limits.projects} owned projects · up to ${library.limits.members} people per owned project`;
    for (const project of library.projects) {
      const group = element("details", "", "shared-project-group"); group.open = expandedProjects.has(project.id);
      const summary = element("summary"); summary.title = project.repository; summary.dataset["project"]=project.id;
      summary.append(createIcon(ChevronRight),createIcon(FolderOpen),element("strong",project.name));
      const rows = element("div", "", "shared-project-conversations");
      const known = projectSnapshots.get(project.id);
      const create = button("New project conversation", () => { reveal(); void task(async () => { await openProject(project.id); apply(await window.adcode.collab.sharedSession(project.id,"New conversation"),true); }); });
      create.dataset["project"]=project.id; create.classList.add("shared-new-conversation"); summary.append(create);
      create.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();});
      for (const session of known?.sessions ?? []) {
        const row = button(session.title, () => { reveal(); void task(async () => { const next = await window.adcode.collab.sharedSnapshot(project.id,session.id); apply(next,true); }); });
        row.className="shared-history-row"; row.dataset["project"]=project.id; row.dataset["session"]=session.id;
        row.setAttribute("aria-current",String(project.id===selected&&session.id===snapshot?.selectedSession));
        row.replaceChildren(createIcon(MessageSquare),element("span",session.title)); rows.append(row);
      }
      if (!known?.sessions.length) rows.append(element("p",known?"No conversations yet":"Expand to load conversations","projects-muted"));
      group.append(summary,rows);
      group.addEventListener("toggle",()=>{
        if (!group.open) { expandedProjects.delete(project.id); return; }
        expandedProjects.add(project.id);
        if (!projectSnapshots.has(project.id)) void window.adcode.collab.sharedSnapshot(project.id).then(next=>{projectSnapshots.set(project.id,next);renderLibrary();}).catch(error=>showError(error instanceof Error?error.message:"Could not load conversations"));
      });
      list.append(group);
    }
    if(!library.projects.length) list.append(element("p","Share your current GitHub project, or join one with an invite.","projects-muted"));
    if(focused?.project) [...list.querySelectorAll<HTMLElement>("[data-project]")].find(row=>row.tagName===focused.tag&&row.dataset["project"]===focused.project&&row.dataset["session"]===focused.session)?.focus({preventScroll:true});
  }
  async function loadLibrary() { library=await window.adcode.collab.sharedLibrary(); renderLibrary(); }
  async function openProject(id: string) {
    const request = ++generation; clearTimeout(polling); selected=id; renderLibrary();
    const next=await window.adcode.collab.sharedSnapshot(id);
    if(request!==generation) return; apply(next,true); schedule();
  }
  function schedule() { clearTimeout(polling); if(isVisible()) polling=window.setTimeout(()=>{ void poll(); },3000); }
  async function poll() {
    if(!isVisible()||!snapshot) return;
    const request=generation, id=snapshot.id, session=snapshot.selectedSession;
    try {
      if(document.visibilityState!=="hidden") {
        const next=await window.adcode.collab.sharedSnapshot(id,session);
        if(request!==generation) return; apply(next,false);
      }
    } catch(error) { if(request===generation) { const message=error instanceof Error ? error.message : "Connection interrupted. Retrying…"; if(/not a member|access removed/i.test(message)) { clearProject(); void loadLibrary().catch(()=>{}); } showError(message); } }
    finally { if(request===generation) schedule(); }
  }
  function mergeMessages(incoming: ProjectChatMessage[]) { const merged=new Map(messages.map(m=>[m.seq,m])); for(const m of incoming) merged.set(m.seq,m); messages=[...merged.values()].sort((a,b)=>a.seq-b.seq); }
  function renderMessages(scroll: boolean) {
    const distance=timeline.scrollHeight-timeline.clientHeight-timeline.scrollTop, previousHeight=timeline.scrollHeight, previousTop=timeline.scrollTop;
    const previousFirst=Number(timeline.dataset["first"]??Number.MAX_SAFE_INTEGER);
    const key=messages.map(m=>`${m.seq}:${m.id}`).join(",");
    if(timeline.dataset["messages"]!==key) {
      timeline.dataset["messages"]=key; timeline.dataset["first"]=String(messages[0]?.seq??Number.MAX_SAFE_INTEGER); timeline.replaceChildren();
      for(const message of messages) {
        const row=element("article","","shared-message"); row.dataset["kind"]=message.kind;
        const requester=snapshot?.members.find(member=>member.uid===message.authorId)?.name??"a project member";
        const meta=element("div","","shared-message-meta"); meta.append(element("strong",message.kind==="member"?message.authorName:`Assistant · via ${requester}`),element("time",new Date(message.at).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})));
        const messageBody=element("div",message.text,"shared-message-text");
        if(message.kind === "assistant") messageBody.innerHTML=renderChatMessageHtml(message.text);
        row.append(meta,messageBody); timeline.append(row);
      }
      if(!messages.length) timeline.append(element("p",snapshot?.selectedSession ? "Start the conversation. Everyone in this project can participate." : "Start a session to begin your project's shared conversation.","projects-muted"));
      if(scroll||distance<60) timeline.scrollTop=timeline.scrollHeight;
      else timeline.scrollTop=previousTop+((messages[0]?.seq??Number.MAX_SAFE_INTEGER)<previousFirst?Math.max(0,timeline.scrollHeight-previousHeight):0);
    }
    older.hidden=!hasOlder;
  }
  function apply(next: SharedProjectSnapshot, reset: boolean) {
    const changed=reset||next.id!==snapshot?.id||next.selectedSession!==snapshot?.selectedSession;
    const previous=snapshot;
    snapshot=next; selected=next.id; projectSnapshots.set(next.id,next); if(changed) expandedProjects.add(next.id);
    if(library) library={...library,projects:library.projects.map(project=>project.id===next.id?next:project)};
    renderLibrary(); showError("");
    if(changed) { messages=[]; hasOlder=next.hasOlder; input.value=drafts.get(draftKey()??"")??""; nonce=null; }
    mergeMessages(next.messages); title.textContent=next.name + " / " + (next.sessions.find(session=>session.id===next.selectedSession)?.title ?? "Conversations"); projectInfo.textContent=`${next.repository} · ${next.memberCount}/${next.memberLimit} people${next.archived ? " · Archived · read-only" : ""}`;
    if(!previous||next.id!==previous.id||next.invite!==previous.invite||next.liveInvite!==previous.liveInvite||next.archived!==previous.archived||next.selfId!==previous.selfId) {
    actions.replaceChildren();
    if(next.invite) actions.append(button("Copy project invite",()=>{ void window.adcode.clipboard.writeText(next.invite!).then(()=>showError("Project invite copied.")); }));
    if(next.liveInvite) actions.append(button("Join live files",()=>{ void task(async()=>{ const name=next.members.find(m=>m.uid===next.selfId)?.name??"Teammate"; await window.adcode.collab.join(next.liveInvite!,name); }); }));
    else if(!next.archived) actions.append(button("Start live files",()=>{ void task(async()=>{ const name=next.members.find(m=>m.uid===next.selfId)?.name??"Teammate"; await window.adcode.collab.host({bind:"internet",port:0,displayName:name,sharedProjectId:next.id}); await poll(); }); }));
    if(next.ownerId===next.selfId&&!next.archived) {
      actions.append(button("Replace invite",()=>{ void task(async()=>{ if(await deps.confirm("Replace the project invite?","The old invite will stop working. Current members keep access.","Replace invite")) apply(await window.adcode.collab.sharedManage(next.id,"invite") as SharedProjectSnapshot,false); }); }));
      actions.append(button("Archive project",()=>{ void task(async()=>{ if(!await deps.confirm("Archive this project?","Live files will end and chats become read-only. The project will stop using an ownership slot.","Archive project")) return; await window.adcode.collab.sharedManage(next.id,"archive"); await loadLibrary(); await openProject(next.id); }); }));
    }
    if(next.ownerId!==next.selfId) actions.append(button("Leave project",()=>{ void task(async()=>{ if(!await deps.confirm("Leave this project?","You will lose access to its shared sessions and live files.","Leave project")) return; await window.adcode.collab.sharedManage(next.id,"remove",next.selfId); clearProject(); await loadLibrary(); }); }));
    }
    const focused=document.activeElement;
    const sessionButtons=next.sessions.map(session=>{
      const row=button(`${session.title}${session.pending?" · AI replying…":""}`,()=>{ void task(async()=>{ const id=++generation; const changed=await window.adcode.collab.sharedSnapshot(next.id,session.id); if(id!==generation) return; apply(changed,true); schedule(); }); });
      row.dataset["session"]=session.id; row.setAttribute("aria-pressed",String(session.id===next.selectedSession)); return row;
    });
    const focusedId=focused instanceof HTMLElement?focused.dataset["session"]:undefined;
    sessions.replaceChildren(...sessionButtons); if(focusedId) sessionButtons.find(b=>b.dataset["session"]===focusedId)?.focus({preventScroll:true});
    members.replaceChildren();
    for(const member of next.members) {
      const row=element("div","","shared-member"); row.append(element("strong",`${member.name}${member.uid===next.ownerId?" · Owner":""}`),element("span",`${member.messages} messages · ${member.sessions} sessions started`,"projects-muted"));
      if(next.selfId===next.ownerId&&member.uid!==next.ownerId) row.append(button("Remove",()=>{ void task(async()=>{ if(!await deps.confirm(`Remove ${member.name}?`,"Their live-file access will end and the old invite will be replaced.","Remove member")) return; await window.adcode.collab.sharedManage(next.id,"remove",member.uid); await poll(); }); })); members.append(row);
    }
    renderMessages(changed); composer.hidden=!next.selectedSession||next.archived; newSession.disabled=next.archived;
    pending.textContent=next.sessions.find(s=>s.id===next.selectedSession)?.pending?"AI is replying for the team…":"";
    send.disabled=posting||next.archived; ask.disabled=posting||next.archived||!!next.sessions.find(s=>s.id===next.selectedSession)?.pending;
  }
  function clearProject() {
    generation++; clearTimeout(polling); snapshot=null; selected=null; messages=[]; hasOlder=false;
    actions.replaceChildren(); sessions.replaceChildren(); members.replaceChildren(); timeline.replaceChildren(); delete timeline.dataset["messages"];
    title.textContent="Project conversations"; projectInfo.textContent="Choose a project to see its shared conversations.";
    composer.hidden=true; older.hidden=true; newSession.disabled=true; pending.textContent="";
  }
  async function post(askAi: boolean) {
    if(posting||!snapshot?.selectedSession||!input.value.trim()||snapshot.archived) return;
    const id=snapshot.id, session=snapshot.selectedSession, submitted=input.value, request=generation; nonce??=crypto.randomUUID(); posting=true; send.disabled=true; ask.disabled=true; showError("");
    try {
      const next=await window.adcode.collab.sharedMessage(id,session,submitted,askAi,nonce);
      if(request!==generation) return;
      if(input.value===submitted) { input.value=""; drafts.delete(`${id}:${session}`); nonce=null; } apply(next,false); timeline.scrollTop=timeline.scrollHeight;
    } catch(error) { showError(error instanceof Error?error.message:"Your message could not be sent. It is still here so you can retry."); }
    finally { posting=false; if(snapshot) { send.disabled=snapshot.archived; ask.disabled=snapshot.archived||!!snapshot.sessions.find(s=>s.id===snapshot?.selectedSession)?.pending; } }
  }
  refresh.addEventListener("click",()=>{ void task(async()=>{ await loadLibrary(); if(snapshot) await poll(); }); });
  window.adcode.account.onChanged(()=>{ projectSnapshots.clear(); clearProject(); void task(()=>loadLibrary()); });
  window.adcode.collab.onSharedChanged(id=>{ if(isVisible()&&id===snapshot?.id) void poll(); });
  composer.hidden=true;
  return {
    mount(host: HTMLElement, navigation: HTMLElement, show: () => void) { panel.close(); integrated={host,show}; host.classList.add("shared-chat-host"); host.hidden=true; host.append(main); sidebar.classList.add("shared-library-inline"); navigation.append(sidebar); const tools=element("div","","shared-library-tools"); for(const child of [...sidebar.children]) if(child instanceof HTMLButtonElement) tools.append(child); sidebar.insertBefore(tools,list); void task(()=>loadLibrary()); },
    close() { active=false; clearTimeout(polling); generation++; if(integrated) integrated.host.hidden=true; else panel.close(); },
    open(id?: string) { reveal(); void task(async()=>{ await loadLibrary(); const target=id??selected??library?.projects[0]?.id; if(target) await openProject(target); }); } };
}
