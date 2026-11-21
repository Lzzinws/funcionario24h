import "server-only";
import { z } from "zod";

/**
 * Variáveis de ambiente do servidor, validadas na primeira leitura.
 * Nunca importe este módulo em componentes de cliente ("server-only" impede).
 */
const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

let cached: z.infer<typeof serverSchema> | null = null;

export function serverEnv() {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuração ausente ou inválida: ${missing}. Veja .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Lê uma variável opcional de integração sem quebrar o app quando ausente. */
export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

/** true quando as variáveis do Supabase estão presentes (permite exibir aviso amigável). */
export function isSupabaseConfigured(): boolean {
  return serverSchema.safeParse(process.env).success;
}
