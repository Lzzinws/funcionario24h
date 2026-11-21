import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "../auth-form";
import { signIn } from "../actions";

export const metadata: Metadata = { title: "Entrar" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const { next, erro } = await searchParams;
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Entrar</h1>
      <p className="mb-8 mt-1 text-sm text-sage-dark">Acompanhe sua equipe digital e as aprovações pendentes.</p>
      {erro ? <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">O link de acesso é inválido ou expirou. Entre com sua senha ou solicite outro link.</p> : null}
      <AuthForm
        action={signIn}
        hidden={{ next: next ?? "/painel" }}
        submitLabel="Entrar"
        pendingLabel="Entrando…"
        fields={[
          { name: "email", label: "E-mail", type: "email", autoComplete: "email" },
          { name: "password", label: "Senha", type: "password", autoComplete: "current-password" },
        ]}
        footer={
          <div className="flex flex-wrap justify-between gap-2 text-[13px]">
            <Link href="/recuperar-senha" className="text-sage-dark hover:text-ink">Esqueci minha senha</Link>
            <Link href="/cadastrar" className="font-medium text-forest hover:underline">Criar conta</Link>
          </div>
        }
      />
    </>
  );
}
