import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: logs, error } = await supabase.from("generation_logs").select("id,message,detail").order("created_at", { ascending: false });
if (error) throw error;

const corruptedLogs = (logs ?? []).filter((log) => hasQuestionMarkMojibake(log.message) || hasQuestionMarkMojibake(log.detail));
const updates = [];

for (const log of corruptedLogs) {
  const replacement = inferReplacement(log);
  const { error: updateError } = await supabase
    .from("generation_logs")
    .update({
      message: replacement.message,
      detail: replacement.detail,
    })
    .eq("id", log.id);
  if (updateError) throw updateError;
  updates.push({ id: log.id, ...replacement });
}

console.log(JSON.stringify({ scanned: logs?.length ?? 0, fixed: updates.length, updates }, null, 2));

function hasQuestionMarkMojibake(value) {
  const text = String(value ?? "");
  const compact = text.replace(/\s/g, "");
  if (!compact) return false;
  if (/^[?？]+$/.test(compact)) return true;
  const questionMarks = (compact.match(/[?？]/g) ?? []).length;
  return compact.length >= 6 && questionMarks / compact.length > 0.4;
}

function inferReplacement(log) {
  const detail = String(log.detail ?? "");
  const rangeMatch = detail.match(/(\d+)\s*-\s*(\d+)/);
  if (rangeMatch) {
    return {
      message: "历史日志编码已修复",
      detail: `原日志包含不可恢复的问号乱码，疑似关联第 ${rangeMatch[1]}-${rangeMatch[2]} 张图片操作；已替换为可读说明。`,
    };
  }

  return {
    message: "历史日志编码已修复",
    detail: "原日志包含不可恢复的问号乱码；已替换为可读说明。",
  };
}
