/**
 * A tab opened before a deploy keeps running the old build. Its next navigation asks for
 * that build's chunks, which the deploy removed, and the page breaks with 404s on
 * `/_next/static/chunks/...` and "Refused to execute script ... MIME type" - reported on
 * 2026-10-08, the morning after a deploy. Reloading once loads the current page with its
 * own chunks.
 *
 * An inline script in `<head>`, not a component, because it has to be listening before any
 * build chunk loads: when the page's own first chunks are the missing ones, a component
 * that lives in those chunks never runs.
 *
 * Only build assets count, and a tab reloads for this at most once in ten minutes: a chunk
 * missing from the current build too is a real fault that a reload cannot fix. Without
 * session storage there is no way to keep that promise, so nothing reloads.
 */
export const STALE_DEPLOY_KEY = "adcode.stale-deploy-reload";
export const STALE_DEPLOY_QUIET_MS = 10 * 60_000;

export const STALE_DEPLOY_SCRIPT = `(()=>{const K='${STALE_DEPLOY_KEY}',Q=${STALE_DEPLOY_QUIET_MS};const reload=()=>{try{const last=Number(sessionStorage.getItem(K))||0,now=Date.now();if(last&&now-last<=Q)return;sessionStorage.setItem(K,String(now))}catch{return}location.reload()};const built=u=>/\\/_next\\/static\\//.test(u||'');addEventListener('error',e=>{const t=e.target;if(!t||!t.tagName)return;if((t.tagName==='SCRIPT'&&built(t.src))||(t.tagName==='LINK'&&t.rel==='stylesheet'&&built(t.href)))reload()},true);addEventListener('unhandledrejection',e=>{const r=e.reason;const s=r&&r.name?r.name+' '+r.message:String(r);if(/ChunkLoadError|Loading chunk [\\w./-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(s))reload()})})()`;
