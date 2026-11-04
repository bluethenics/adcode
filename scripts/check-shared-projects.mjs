import { Miniflare, convertV4MiniflareOptions } from "../apps/cloud/node_modules/miniflare/dist/src/index.js";
import { build } from "esbuild";
import assert from "node:assert/strict";

// Authentication is supplied by this test-only adapter; production uses Firebase.
const fixture = await build({ stdin: { contents: `
import { projectRoute, ProjectDirectory, SharedProject } from './apps/collab-relay/src/projects.ts';
import { CollabRoom } from './apps/collab-relay/src/index.ts';
import { PriorityQueue, RequestPriority } from './apps/collab-relay/src/priority.ts';
export {ProjectDirectory,SharedProject,CollabRoom,PriorityQueue,RequestPriority};
export default {async fetch(request,env) {
 const url=new URL(request.url), uid=request.headers.get('x-test-uid')||'owner';
 if(url.pathname==='/queue') {const {op,...body}=await request.json(); const q=env.REQUEST_QUEUES.getByName('test'); return Response.json((await q[op](...body.args))??{ok:true});}
 return projectRoute(request,env,uid);
}};`, resolveDir: process.cwd(), sourcefile: "shared-project-test.ts" }, bundle: true, write: false, format: "esm", platform: "neutral", external: ["cloudflare:workers"], conditions: ["workerd","worker","browser"], logLevel: "silent" });
const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "projects", modules: true, script: fixture.outputFiles[0].text, compatibilityDate: "2026-10-13", durableObjects: Object.fromEntries(["ProjectDirectory","SharedProject","CollabRoom","PriorityQueue"].map((className,i)=>[["PROJECT_ACCOUNTS","SHARED_PROJECTS","ROOMS","REQUEST_QUEUES"][i],{className,useSQLite:true}])), serviceBindings: { ENTITLEMENTS: { name: "plans", entrypoint: "Plans" } } }, { name: "plans", modules: true, compatibilityDate: "2026-10-13", script: `import {WorkerEntrypoint} from 'cloudflare:workers'; export class Plans extends WorkerEntrypoint { getPlan(uid) {return {plan:uid.startsWith('pro-')?'pro':'free',endsAt:Date.now()+600000};}} export default {fetch(){return new Response('fixture')}};` }] }));
let checks = 0;
async function call(uid,path,body,expected=200) {
  const r=await mf.dispatchFetch(`https://projects${path}`,{method:body===undefined?"GET":"POST",headers:{"x-test-uid":uid,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await r.json(); assert.equal(r.status,expected,JSON.stringify(result)); checks++; return result;
}
const create=(uid,repository,expected=200)=>call(uid,"/projects/create",{repository,name:repository,displayName:uid},expected);
const join=(uid,invite,expected=200)=>call(uid,"/projects/join",{invite,displayName:uid},expected);
const queue=(op,...args)=>call("owner","/queue",{op,args});
try {
  const a=await create("owner","team/one");
  assert.equal((await create("owner","team/one")).id,a.id);
  await create("owner","team/two",402);
  const joined=await Promise.all([join("guest1",a.invite),join("guest2",a.invite)]);
  assert.equal(joined[1].memberCount,3);
  await join("guest3",a.invite,402);
  assert.equal((await call("guest1","/projects")).owned,0);
  await create("guest1","team/guest-owned");
  await call("outsider",`/projects/${a.id}`,undefined,403);
  const root=`/projects/${a.id}`;
  await call("guest1",root+"/sessions",{id:"session-a",title:"Shared work"});
  assert.equal((await call("owner",root)).sessions[0].title,"Shared work");
  const post={sessionId:"session-a",text:"Hello team",id:"message-a",ask:false,kind:"assistant",authorId:"owner"};
  await call("guest1",root+"/messages",post);
  await call("guest1",root+"/messages",post);
  let snap=await call("owner",root);
  assert.equal(snap.messages.length,1); assert.equal(snap.messages[0].kind,"member"); assert.equal(snap.messages[0].authorId,"guest1");
  const turn=await call("guest2",root+"/messages",{...post,id:"ask-a",ask:true});
  assert.ok(turn.lease); assert.equal(turn.snapshot.sessions[0].pending,true);
  await call("owner",root+"/renew",{sessionId:"session-a",lease:turn.lease},409);
  await call("guest2",root+"/renew",{sessionId:"session-a",lease:turn.lease});
  await call("owner",root+"/messages",{...post,id:"ask-b",ask:true},409);
  await call("owner",root+"/finish",{sessionId:"session-a",lease:turn.lease,text:"forged"},409);
  await call("guest2",root+"/finish",{sessionId:"session-a",lease:turn.lease,text:"Team reply"});
  assert.equal((await call("guest1",root)).messages.at(-1).text,"Team reply");
  await call("guest1",root+"/members",{uid:"guest2"},403);
  await call("guest2",root+"/messages",{...post,id:"removed-turn",ask:true});
  await call("owner",root+"/members",{uid:"guest2"});
  await call("guest2",root,undefined,403); await join("guest2",a.invite,403);
  snap=await call("owner",root); assert.notEqual(snap.invite,a.invite);
  assert.equal(snap.sessions[0].pending,false);
  await join("guest3",snap.invite);
  await call("owner",root+"/archive",{});
  await call("guest1",root+"/messages",{...post,id:"archived"},409);
  assert.equal((await call("guest1",root)).messages.length,4);
  await create("owner","team/two");
  const race=await Promise.all([create("racer","race/one"),create("racer","race/two",402)]); assert.ok(race[0].id);
  const pro=await create("pro-owner","pro/one");
  for(let i=0;i<4;i++) await join(`pro-guest-${i}`,pro.invite);
  await create("pro-owner","pro/two");
  assert.equal((await call("pro-owner","/projects")).limits.members,15);

  const blockers=[]; for(let i=0;i<16;i++) blockers.push(await queue("enter",`blocker-${i}`,null));
  assert.ok(blockers.every(x=>x.admitted));
  const free=await queue("enter","free",null), paid={id:"pro",endsAt:Date.now()+600000}, high=await queue("enter","paid",paid), best=await queue("enter","best",{...paid,id:"unlimited"});
  assert.equal(free.admitted,false); assert.equal(high.admitted,false); assert.equal(best.admitted,false);
  await queue("release","wrong-user",blockers[0].id); assert.equal((await queue("check","best",best.id)).admitted,false);
  await queue("release","blocker-0",blockers[0].id); assert.equal((await queue("check","best",best.id)).admitted,true);
  assert.equal((await queue("check","paid",high.id)).admitted,false);
  await queue("release","best",best.id); assert.equal((await queue("check","paid",high.id)).admitted,true);
  await queue("release","paid",high.id); assert.equal((await queue("check","free",free.id)).admitted,true);
  assert.equal(await queue("renew","wrong-user",free.id),false);
  assert.equal(await queue("renew","free",free.id),true);
  await queue("enter","limited",null); await queue("enter","limited",null);
  assert.match((await queue("enter","limited",null)).error,/already/);
  console.log(`Shared projects and priority queues: ${checks} real Worker/SQLite checks passed.`);
} finally { await mf.dispose(); }
