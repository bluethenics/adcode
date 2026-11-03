import { describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

describe("verification email controls", () => {
  it("bypasses a stale unverified user cache immediately after confirmation on another worker",async()=>{
    const store=createMemoryStore();const isVerified=vi.fn(async()=>true);
    const handler=createFetchHandler({store,clock:{now:()=>1000},verifier:{verify:async()=>({uid:"member",claims:{email:"member@example.test",email_verified:false}})},tagflow:{identity:{lookup:async()=>({email:"member@example.test",emailVerified:false}),sendVerification:async()=>false},emailProof:{isVerified,send:async()=>false,handle:async()=>new Response()}}});
    const result=await handler(new Request("https://adcode.test/v1/ai/account/verification",{headers:{authorization:"Bearer member"}}));
    expect(await result.json()).toMatchObject({verified:true});expect(isVerified).toHaveBeenCalledWith("member","member@example.test");expect((await store.getUser("member"))?.emailVerified).toBe(true);
  });
  it("uses the ADCode mail path when Firebase delivery is unavailable and remembers verified ownership", async () => {
    const store = createMemoryStore();
    const send = vi.fn(async () => true);
    const identity={lookup:async()=>({email:"member@example.test",emailVerified:false}),sendVerification:vi.fn(async()=>false)};
    const handler=createFetchHandler({store,clock:{now:()=>1000},verifier:{verify:async()=>({uid:"member",claims:{email:"member@example.test",email_verified:false}})},tagflow:{identity,emailProof:{send,handle:async()=>new Response()}}});
    const req=(method:string)=>handler(new Request("https://adcode.test/v1/ai/account/verification",{method,headers:{authorization:"Bearer member"}}));
    expect(await(await req("POST")).json()).toMatchObject({sent:true});expect(send).toHaveBeenCalledWith("member","member@example.test",1000);expect(identity.sendVerification).not.toHaveBeenCalled();
    const user=await store.getUser("member");await store.putUser({...user!,emailVerified:true});
    expect(await(await req("GET")).json()).toMatchObject({verified:true});
  });
  function setup() {
    let now = 1_000_000;
    const identity = { lookup: vi.fn(async () => ({ email: "member@example.test", emailVerified: false })), sendVerification: vi.fn(async () => true) };
    const handler = createFetchHandler({ store: createMemoryStore(), verifier: { verify: async token => token === "member" ? { uid: "member", claims: { email: "member@example.test", email_verified: false } } : null }, clock: { now: () => now }, tagflow: { identity } });
    const request = (method: "GET" | "POST", token = "member") => handler(new Request("https://adcode.test/v1/ai/account/verification", { method, headers: { authorization: `Bearer ${token}` } }));
    return { identity, request, advance: () => { now += 60_001; } };
  }
  it("checks status without sending, sends explicitly, and limits duplicate resends", async () => {
    const { identity, request, advance } = setup();
    expect((await request("GET")).status).toBe(200); expect(identity.sendVerification).not.toHaveBeenCalled();
    expect(await (await request("POST")).json()).toMatchObject({ sent: true, verified: false, email: "member@example.test" });
    expect((await request("POST")).status).toBe(429);
    expect(identity.sendVerification).toHaveBeenCalledTimes(1);
    advance(); expect((await request("POST")).status).toBe(200);
    expect(identity.sendVerification).toHaveBeenCalledTimes(2);
  });
  it("does not claim successful delivery after a provider failure, and permits a one-minute retry", async () => {
    const { identity, request, advance } = setup(); identity.sendVerification.mockResolvedValueOnce(false);
    expect(await (await request("POST")).json()).toMatchObject({ sent: false, retryAfter: 60 });
    expect((await request("POST")).status).toBe(429);
    advance(); expect(await (await request("POST")).json()).toMatchObject({ sent: true });
  });
  it("detects verification immediately despite stale token claims and refuses anonymous callers", async () => {
    const { identity, request } = setup(); identity.lookup.mockResolvedValue({ email: "member@example.test", emailVerified: true });
    expect(await (await request("GET")).json()).toMatchObject({ verified: true });
    expect(identity.sendVerification).not.toHaveBeenCalled();
    expect((await request("POST", "invalid")).status).toBe(401);
  });
});
