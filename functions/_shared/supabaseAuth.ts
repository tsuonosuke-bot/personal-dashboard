function isLegacyJwtKey(key: string): boolean {
  return /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key);
}

export function supabaseHeaders(
  key: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    apikey: key,
  };

  // Supabase's current sb_secret_* keys belong only in `apikey`. Legacy
  // service_role JWTs additionally need the bearer header so PostgREST can
  // assume the service role and bypass RLS for this server-side API.
  if (isLegacyJwtKey(key)) headers.Authorization = `Bearer ${key}`;

  return { ...headers, ...extra };
}
