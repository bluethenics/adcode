export const REPORT_BODY_MAX=4000;
export const REPORT_LOG_DIVIDER="\n\n--- Debug log ---\n";
export const REPORT_DEBUG_RESERVE=1200;
export const reportDetailsLimit=(withLog:boolean):number=>withLog?REPORT_BODY_MAX-REPORT_LOG_DIVIDER.length-REPORT_DEBUG_RESERVE:REPORT_BODY_MAX;

/** Never silently replace a diagnostic attachment with a long pasted project description. */
export function composeReportBody(details:string,log?:string):{ok:true;body:string}|{ok:false;message:string}{
  const text=details.trim(),limit=reportDetailsLimit(log!==undefined);
  if(text.length>limit)return {ok:false,message:`Keep details to ${limit.toLocaleString("en-US")} characters${log===undefined?"":" to leave room for the debug log"}. Your text is still here to edit.`};
  if(log===undefined)return {ok:true,body:text};
  if(!log.trim())return {ok:false,message:"The debug log is not ready. Try again, or uncheck Include debug log to send your message without it."};
  return {ok:true,body:text+REPORT_LOG_DIVIDER+log.slice(0,REPORT_BODY_MAX-text.length-REPORT_LOG_DIVIDER.length)};
}
