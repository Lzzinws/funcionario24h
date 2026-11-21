import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Client com service_role: IGNORA RLS. Usar somente em webhooks, worker e
 * ações de servidor que já validaram a organização. Toda consulta feita com
 * este client DEVE filtrar explicitamente por organization_id.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
