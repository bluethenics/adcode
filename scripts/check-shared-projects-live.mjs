import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Disposable accounts exercise the deployed authentication and service bindings.
// Firebase REST signup does not send mail; no delivery is triggered by this check.
const apiKey="AIzaSyATZzX5Fw2HjR34VxB3UQWTmljprA5uXqE", users=[], origin="https://projects.bluethenics.com";
let owner, project;
async function firebase(method,body) {
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${apiKey}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const value=await r.json(); if(!r.ok) throw Error(`Disposable-account setup failed (${value.error?.message??r.status})`); return value;
}
async function call(user,path,body,status=200) {
  const r=await fetch(origin+path,{method:body===undefined?"GET":"POST",headers:{authorization:`Bearer ${user.idToken}`,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await r.json(); assert.equal(r.status,status,JSON.stringify(value)); return value;
}
try {
  const suffix=Date.now();
  for(let i=0;i<3;i++) users.push(await firebase("signUp",{email:`adcode-project-check-${suffix}-${i}@example.test`,password:randomBytes(24).toString("base64url"),returnSecureToken:true}));
  [owner]=users;
  project=await call(owner,"/projects/create",{name:"Release integration check",repository:`adcode-check/release-${suffix}`,displayName:"Test owner"});
  assert.equal(project.memberLimit,3);
  await call(users[1],"/projects/join",{invite:project.invite,displayName:"Test teammate"});
  const root=`/projects/${project.id}`;
  await call(users[2],root,undefined,403);
  await call(owner,"/projects/create",{name:"Quota check",repository:`adcode-check/extra-${suffix}`,displayName:"Test owner"},402);
  const session=await call(users[1],root+"/sessions",{id:"release-session",title:"Team session"});
  assert.equal(session.sessions.length,1);
  await call(users[1],root+"/messages",{sessionId:"release-session",id:"release-message",text:"Visible to both project members",ask:false});
  assert.equal((await call(owner,root)).messages[0].text,"Visible to both project members");
  await call(owner,root+"/members",{uid:users[1].localId});
  await call(users[1],root,undefined,403);
  console.log("LIVE_SHARED_PROJECTS_OK: authenticated membership, real Free entitlement, project quota, shared session/message persistence, access revocation.");
} finally {
  if(owner&&project) await call(owner,`/projects/${project.id}/archive`,{}).catch(()=>{});
  for(const user of users) await firebase("delete",{idToken:user.idToken}).catch(()=>{});
}
