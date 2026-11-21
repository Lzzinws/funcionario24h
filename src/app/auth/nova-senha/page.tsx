import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";
import { AuthForm } from "../../(auth)/auth-form";
import { updatePassword } from "../../(auth)/actions";

export const metadata: Metadata = { title: "Nova senha" };

export default async function NewPasswordPage() {
  if (!isSupabaseConfigured()) redirect("/entrar");
  await requireUser();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Criar nova senha</h1>
      <p className="mb-8 mt-1 text-sm text-sage-dark">Escolha uma senha que você não usa em outros serviços.</p>
      <AuthForm
        action={updatePassword}
        submitLabel="Salvar nova senha"
        pendingLabel="Salvando…"
        fields={[{ name: "password", label: "Nova senha", type: "password", autoComplete: "new-password", hint: "Mínimo de 8 caracteres, com letras e números." }]}
      />
    </main>
  );
}
