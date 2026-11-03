import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountEmailProofStore } from "../src/accountEmailProof.ts";
export function createAccountEmailProofStore(): AccountEmailProofStore {
  let client: SupabaseClient | undefined;
  const db = async () => {
    if (client) return client;
    const url=process.env["SUPABASE_URL"],key=process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if(!url||!key)throw new Error("Verification database unavailable");
    const {createClient}=await import("@supabase/supabase-js");
    client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}); return client;
  };
  return {
    async verified(uid,email) {
      const {data,error}=await (await db()).from("users").select("email,email_verified,status").eq("uid",uid).maybeSingle();
      if(error)throw new Error("Could not check verified email");
      return data?.email_verified===true && data.email?.toLowerCase()===email && data.status==="active";
    },
    async issue(uid,email,hash,expiresAt,now) {
      const {data,error}=await (await db()).rpc("issue_account_email_proof",{p_uid:uid,p_email:email,p_hash:hash,p_expires_at:expiresAt,p_now:now});
      if(error)throw new Error("Could not prepare verification email");return data===true;
    },
    async confirm(hash,now) {
      const {data,error}=await (await db()).rpc("confirm_account_email_proof",{p_hash:hash,p_now:now});
      if(error)throw new Error("Could not confirm verification email");
      return data==="verified"||data==="expired"||data==="changed-account"?data:"invalid";
    },
  };
}
