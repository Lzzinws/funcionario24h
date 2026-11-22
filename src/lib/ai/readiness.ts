import "server-only";

/** Verifica (sem expor valores) se o servidor tem as chaves necessárias para a IA. */
export function aiTestReadiness(): { ok: boolean; missing: string[] } {
  const missing = [
    ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY],
    ["GEMINI_API_KEY", process.env.GEMINI_API_KEY],
  ].filter(([, v]) => !v || v.trim().length < 20).map(([k]) => k as string);
  return { ok: missing.length === 0, missing };
}
