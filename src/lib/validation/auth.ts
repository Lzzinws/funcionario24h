import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido"),
  password: z.string().min(1, "Informe sua senha"),
});

export const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Informe seu nome").max(100),
  email: z.string().trim().email("Informe um e-mail válido"),
  password: z
    .string()
    .min(8, "Use pelo menos 8 caracteres")
    .regex(/[A-Za-z]/, "Inclua ao menos uma letra")
    .regex(/[0-9]/, "Inclua ao menos um número"),
  accept_terms: z.literal("on", { message: "É preciso aceitar os termos e a política de privacidade" }),
});

export const emailSchema = z.object({ email: z.string().trim().email("Informe um e-mail válido") });
export const newPasswordSchema = signUpSchema.pick({ password: true });

/** Converte erros do zod em { campo: mensagem }. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Aceita apenas caminhos internos para o redirecionamento pós-login. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/painel";
}
