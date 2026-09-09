import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** 環境変数が未設定なら、画面にメッセージを出すための理由を返す（起動は止めない）。 */
export const configError =
  !url || !anonKey
    ? "VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY が設定されていません。.env.example をコピーして .env を作成してください。"
    : null;

export const supabase = createClient(url || "http://localhost", anonKey || "missing-key");
