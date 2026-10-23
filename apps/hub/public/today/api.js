// 今日やることの読み込みと更新。呼び出し側が作る競合確認用の値を変更せず送る。
import { readApiJson } from "../api-client.js";
// ---------- 画面の制御 ----------

export async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { Accept: "application/json", ...(init.headers || {}) },
  });
  const payload = await readApiJson(response);
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(message || "処理を完了できませんでした。再試行してください。");
  }
  return payload;
}

export function sendJson(url, method, action, body) {
  return requestJson(url, {
    method,
    headers: { "Content-Type": "application/json", "X-Dashboard-Action": action },
    body: JSON.stringify(body),
  });
}

export const SOURCES = {
  todos: { url: "/api/scheduled-actions", label: "ToDo" },
  habits: { url: "/api/habits", label: "Habit" },
  projects: { url: "/api/projects", label: "Project" },
};
