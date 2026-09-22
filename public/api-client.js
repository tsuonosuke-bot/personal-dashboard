function responseMessage(response) {
  if (response.status === 401) return "認証の有効期限が切れました。ページを再読み込みしてログインしてください。";
  if (response.status === 403) return "この操作を行う権限を確認できませんでした。";
  if (response.status === 404) return "要求した機能が見つかりませんでした。";
  if (response.status === 429) return "アクセスが集中しています。少し待ってから再試行してください。";
  if (response.status >= 500) return "サーバーへ接続できませんでした。少し待ってから再試行してください。";
  return response.ok
    ? "サーバーから想定外の応答を受信しました。再試行してください。"
    : "処理を完了できませんでした。再試行してください。";
}

export async function readApiJson(response) {
  const contentType = response.headers.get("Content-Type")?.toLowerCase() || "";
  if (!contentType.includes("json")) throw new Error(responseMessage(response));

  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error(responseMessage(response));
  }
  if (!text.trim()) throw new Error(responseMessage(response));

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("サーバーから想定外の応答を受信しました。再試行してください。");
  }
}
