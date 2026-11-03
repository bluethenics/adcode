import {describe,it,expect,vi} from "vitest";
import {createAccountEmailProof,emailProofHash} from "../src/accountEmailProof.ts";
describe("ADCode email ownership proof",()=>{
 const setup=()=>{
  let record:{uid:string;email:string;hash:string;expires:number}|null=null;let currentEmail="member@example.test";let verified=false;let now=1000;
  const mailer=vi.fn(async(_input:{uid:string;email:string;token:string;url:string})=>true);
  const service=createAccountEmailProof({origin:"https://adcode.example",now:()=>now,send:mailer,store:{
   async verified(_uid,email){return verified && email===currentEmail;},
   async issue(uid,email,hash,expires){if(email!==currentEmail)return false;record={uid,email,hash,expires};return true;},
   async confirm(hash,time){if(!record||record.hash!==hash)return "invalid";const proof=record;record=null;if(proof.expires<=time)return "expired";if(proof.email!==currentEmail)return "changed-account";verified=true;return "verified";}
  }});
  return {service,mailer,isVerified:()=>verified,record:()=>record,setEmail:(email:string)=>{currentEmail=email;},expire:()=>{now+=3_600_001;}};
 };
 it("stores a hash, sends only to the current address and requires explicit confirmation",async()=>{
  const s=setup();expect(await s.service.send("member","member@example.test",1000)).toBe(true);
  const sent=s.mailer.mock.calls[0]![0];expect(s.record()?.hash).toBe(emailProofHash(sent.token));expect(s.record()?.hash).not.toBe(sent.token);
  const preview=await s.service.handle(new Request(sent.url));expect(preview.status).toBe(200);expect(s.isVerified()).toBe(false);expect(await preview.text()).toContain('method="post"');
  const submit=()=>s.service.handle(new Request(sent.url,{method:"POST",body:new URLSearchParams({token:sent.token})}));
  expect((await submit()).status).toBe(200);expect(s.isVerified()).toBe(true);expect((await submit()).status).toBe(410);
 });
 it("rejects wrong tokens, expired links, and links after the email changes",async()=>{
  const s=setup();await s.service.send("member","member@example.test",1000);const sent=s.mailer.mock.calls[0]![0];
  expect((await s.service.handle(new Request("https://adcode.example/?token=bad"))).status).toBe(400);
  expect((await s.service.handle(new Request(sent.url,{method:"POST",body:new URLSearchParams({token:"a".repeat(43)})}))).status).toBe(410);expect(s.isVerified()).toBe(false);
  s.setEmail("changed@example.test");expect((await s.service.handle(new Request(sent.url,{method:"POST",body:new URLSearchParams({token:sent.token})}))).status).toBe(410);expect(s.isVerified()).toBe(false);
  const other=setup();await other.service.send("member","member@example.test",1000);other.expire();expect((await other.service.handle(new Request(other.mailer.mock.calls[0]![0].url,{method:"POST",body:new URLSearchParams({token:other.mailer.mock.calls[0]![0].token})}))).status).toBe(410);
 });
 it("does not send to an address rejected by the authoritative store",async()=>{
  const s=setup();expect(await s.service.send("member","attacker@example.test",1000)).toBe(false);expect(s.mailer).not.toHaveBeenCalled();
 });
});
