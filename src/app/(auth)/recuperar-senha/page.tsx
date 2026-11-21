import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "../auth-form";
import { requestPasswordReset } from "../actions";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function ResetPage() {
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Recuperar senha</h1>
      <p className="mb-8 mt-1 text-sm text-sage-dark">Enviaremos um link para você criar uma nova senha.</p>
      <AuthForm
        action={requestPasswordReset}
        submitLabel="Enviar link"
        pendingLabel="Enviando…"
        fields={[{ name: "email", label: "E-mail", type: "email", autoComplete: "email" }]}
        footer={<Link href="/entrar" className="text-center text-[13px] text-sage-dark hover:text-ink">Voltar para o login</Link>}
      />
    </>
  );
}
