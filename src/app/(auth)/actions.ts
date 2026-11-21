"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { ActionState } from "@/lib/action-result";
import { emailSchema, fieldErrors, newPasswordSchema, safeNext, signInSchema, signUpSchema } from "@/lib/validation/auth";

const NOT_CONFIGURED: ActionState = { ok: false, message: "A plataforma ainda está sendo configurada. O acesso será liberado em breve." };

async function origin() {
  const h = await headers();
  return process.env.NEXT_PUBLIC_APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { ok: false, message: "Confirme seu e-mail pelo link que enviamos antes de entrar." };
    }
    return { ok: false, message: "E-mail ou senha incorretos." };
  }
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: ActionState, form: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = signUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name, terms_accepted_at: new Date().toISOString() },
      emailRedirectTo: `${await origin()}/auth/callback?next=/onboarding`,
    },
  });
  if (error) {
    if (error.code === "user_already_exists") return { ok: false, message: "Este e-mail já tem cadastro. Entre com sua senha." };
    if (error.code === "weak_password") return { ok: false, fieldErrors: { password: "Escolha uma senha mais forte." } };
    return { ok: false, message: "Não foi possível criar a conta agora. Tente novamente em instantes." };
  }
  // Com confirmação de e-mail ativa, não há sessão até o usuário clicar no link.
  if (!data.session) {
    return { ok: true, message: `Enviamos um link de confirmação para ${parsed.data.email}. Abra-o para continuar.` };
  }
  redirect("/onboarding");
}

export async function requestPasswordReset(_: ActionState, form: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = emailSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await origin()}/auth/callback?next=/auth/nova-senha`,
  });
  // Resposta idêntica exista ou não a conta (não revela e-mails cadastrados).
  return { ok: true, message: "Se houver uma conta com este e-mail, você receberá um link para criar uma nova senha." };
}

export async function updatePassword(_: ActionState, form: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, message: "O link expirou. Solicite uma nova recuperação de senha." };
  redirect("/painel");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/entrar");
}
