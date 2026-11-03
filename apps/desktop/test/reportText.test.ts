import {describe,expect,it} from "vitest";
import {composeReportBody,reportDetailsLimit,REPORT_LOG_DIVIDER} from "../src/renderer/dialogs/reportText.ts";
describe("report diagnostic space",()=>{
 it("keeps a useful diagnostic attachment when the description reaches its allowed limit",()=>{
  const details="D".repeat(reportDetailsLimit(true));const diagnostic="OS and model information\n"+"Recent error\n".repeat(400);
  const result=composeReportBody(details,diagnostic);expect(result.ok).toBe(true);if(!result.ok)return;
  expect(result.body.length).toBe(4000);expect(result.body.startsWith(details+REPORT_LOG_DIVIDER)).toBe(true);expect(result.body).toContain("OS and model information");expect(result.body.slice(details.length+REPORT_LOG_DIVIDER.length).length).toBe(1200);
 });
 it("asks for a shorter description instead of silently discarding the selected log",()=>{
  const result=composeReportBody("D".repeat(4000),"OS/model/error");expect(result).toMatchObject({ok:false});if(result.ok)return;expect(result.message).toContain("Your text is still here");
 });
 it("permits the full message without diagnostics and does not claim to attach an unread log",()=>{
  expect(composeReportBody("D".repeat(4000))).toMatchObject({ok:true,body:"D".repeat(4000)});expect(composeReportBody("Issue","")).toMatchObject({ok:false});
 });
});
