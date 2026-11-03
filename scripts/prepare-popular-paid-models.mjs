// Produces reviewable catalogue data. It never publishes or reads a private provider key.
import { readFileSync, writeFileSync } from "node:fs";
const raw=JSON.parse(readFileSync('output/openrouter-model-catalogue-2026-10-29.json','utf8'));
const ids=['deepseek/deepseek-v4.1-flash-1017','deepseek/deepseek-v4.1-flash','z-ai/glm-5.3-flash','openai/gpt-6-luna','tencent/hy4-preview','anthropic/claude-opus-5.5','stepfun/step-5-preview','z-ai/glm-5.3','xiaomi/mimo-v2.6-flash','minimax/minimax-m3.1-flash','qwen/qwen3.8-flash','anthropic/claude-sonnet-5.5','moonshotai/kimi-k3.1-pro'];
const models=ids.map((id,i)=>{
 const m=raw.data.find(m=>m.id===id);
 if(!m || !m.supported_parameters?.includes('tools'))throw new Error(`Model cannot be verified: ${id}`);
 const pricing=[m.pricing,...(m.pricing.overrides??[]).filter(p=>!p.min_prompt_tokens || p.min_prompt_tokens<=262144)];
 const highest=field=>Math.max(...pricing.map(p=>Number(p[field]??0)))*1_000_000;
 return {id:`paid-or-${id.replaceAll('/','-').replaceAll('.','-')}`,name:`${m.name.replace(': ',' · ')} (OpenRouter)`,provider:'openrouter',upstreamModel:id,billing:'wallet',enabled:true,contextWindow:Math.min(m.context_length,1_000_000),maxOutput:8192,inputPrice:highest('prompt'),outputPrice:highest('completion'),cacheInputPrice:highest('input_cache_read')};
});
const providers=[
 {id:'custom-deepseek',name:'DeepSeek',baseUrl:'https://api.deepseek.com'},
 {id:'custom-anthropic',name:'Anthropic',baseUrl:'https://api.anthropic.com/v1'},
 {id:'custom-zai',name:'Z.ai',baseUrl:'https://api.z.ai/api/paas/v4'},
 {id:'custom-minimax',name:'MiniMax',baseUrl:'https://api.minimax.io/v1'},
 {id:'custom-xiaomi',name:'Xiaomi MiMo',baseUrl:'https://api.xiaomimimo.com/v1'},
];
const direct=(id,name,provider,upstreamModel,inputPrice,outputPrice,cacheInputPrice,more={})=>({id,name,provider,upstreamModel,inputPrice,outputPrice,cacheInputPrice,billing:'wallet',enabled:true,contextWindow:1_000_000,maxOutput:8192,...more});
models.unshift(
 direct('paid-deepseek-flash','DeepSeek V4.1 Flash 1017 (Direct)','custom-deepseek','deepseek-flash',0.30,1.20,0.006,{pricingSchedule:'deepseek'}),
 direct('paid-gpt6-luna','GPT-6 Luna · OpenAI (Direct)','openai','gpt-6-luna',0.10,0.50,0.01),
 direct('paid-glm53-flash','GLM 5.3 Flash · Z.ai (Direct)','custom-zai','glm-5.3-flash',0.15,0.50,0.03),
 direct('paid-minimax-m31-flash','MiniMax M3.1 Flash (Direct)','custom-minimax','MiniMax-M3.1-Flash',0.15,0.60,0.015),
 direct('paid-mimo26-flash','MiMo V2.6 Flash · Xiaomi (Direct)','custom-xiaomi','mimo-v2.6-flash',0.14,0.28,0.0028),
 direct('paid-claude-opus55','Claude Opus 5.5 · Anthropic (Direct)','custom-anthropic','claude-opus-5-5',4,20,4),
 direct('paid-claude-sonnet55','Claude Sonnet 5.5 · Anthropic (Direct)','custom-anthropic','claude-sonnet-5-5',2,10,2),
 direct('paid-glm53','GLM 5.3 · Z.ai (Direct)','custom-zai','glm-5.3',1.4,4.4,0.26),
);
// Anthropic's OpenAI compatibility layer does not support prompt caching. Its cache
// price therefore remains ordinary input, rather than advertising native-API discounts.
writeFileSync('output/popular-paid-models-2026-10-29.json',JSON.stringify({providers,models},null,2));
const literal=value=>`$catalogue$${JSON.stringify(value)}$catalogue$::jsonb`;
writeFileSync('supabase/migrations/20261029180301_popular_paid_models.sql',`-- Apply only AFTER the wallet-aware relay is deployed. Missing keys keep models hidden.
-- Public usage rankings, not a claim of verified purchase counts. No balances are credited.
do $$
declare current_config jsonb; extra_models jsonb; extra_providers jsonb;
begin
 select config into current_config from public.tagflow_config where id=1 for update;
 if current_config is null then return; end if;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into extra_models from jsonb_array_elements(${literal(models)}) item
 where not exists(select 1 from jsonb_array_elements(coalesce(current_config->'models','[]'::jsonb)) old where old->>'id'=item->>'id');
 select coalesce(jsonb_agg(item),'[]'::jsonb) into extra_providers from jsonb_array_elements(${literal(providers)}) item
 where not exists(select 1 from jsonb_array_elements(coalesce(current_config->'providers','[]'::jsonb)) old where old->>'id'=item->>'id');
 if jsonb_array_length(coalesce(current_config->'models','[]'::jsonb))+jsonb_array_length(extra_models)>50 then raise exception 'Too many model rows; review the curated catalogue before publishing'; end if;
 update public.tagflow_config set config=jsonb_set(jsonb_set(current_config,'{models}',coalesce(current_config->'models','[]'::jsonb)||extra_models),'{providers}',coalesce(current_config->'providers','[]'::jsonb)||extra_providers),updated_at=floor(extract(epoch from now())*1000)::bigint,updated_by='owner-approved-paid-model-launch' where id=1;
 insert into public.audit_log(admin_uid,action,subject_uid,at) values('owner-approved-paid-model-launch','add-popular-paid-models-35-percent','*',floor(extract(epoch from now())*1000)::bigint);
end $$;
`);
console.log(`Prepared ${models.length} paid model routes and ${providers.length} direct provider connections. Existing model settings are preserved.`);
