// HTTP処理を画面から分離する。URL・ヘッダー・競合確認の本文は呼び出し側の値を保つ。
export { requestApiJson as projectRequest } from "../api-client.js";
