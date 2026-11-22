import "server-only";
import { z } from "zod";

/**
 * Variáveis de ambiente do servidor, validadas na primeira leitura.
 * Nunca importe este módulo em componentes de cliente ("server-only" impede).
 *
 * - publicEnv(): o necessário para o app funcionar com a sessão do usuário (RLS).
 * - serverEnv(): inclui a service_role, exigida apenas por webhooks/worker.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});
const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

function parse<T extends z.ZodTypeAny>(schema: T): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuração ausente ou inválida: ${missing}. Veja .env.example.`);
  }
  return parsed.data;
}

let cachedPublic: z.infer<typeof publicSchema> | null = null;
let cachedServer: z.infer<typeof serverSchema> | null = null;

export function publicEnv() {
  return (cachedPublic ??= parse(publicSchema));
}

export function serverEnv() {
  return (cachedServer ??= parse(serverSchema));
}

/** Lê uma variável opcional de integração sem quebrar o app quando ausente. */
export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

/** true quando o Supabase está conectado (permite exibir aviso amigável). */
export function isSupabaseConfigured(): boolean {
  return publicSchema.safeParse(process.env).success;
}
