"use client";
import Link from "next/link";
import { AuthForm } from "../auth-form";
import { signUp } from "../actions";

export function SignUpForm() {
  return (
    <AuthForm
      action={signUp}
      submitLabel="Criar conta"
      pendingLabel="Criando conta…"
      fields={[
        { name: "full_name", label: "Seu nome", autoComplete: "name" },
        { name: "email", label: "E-mail de trabalho", type: "email", autoComplete: "email" },
        { name: "password", label: "Senha", type: "password", autoComplete: "new-password", hint: "Mínimo de 8 caracteres, com letras e números." },
      ]}
      footer={<p className="text-center text-[13px] text-sage-dark">Já tem conta? <Link href="/entrar" className="font-medium text-forest hover:underline">Entrar</Link></p>}
    >
      {(state) => (
        <div className="grid gap-1">
          <label className="flex items-start gap-2.5 text-[13px] leading-snug text-sage-dark">
            <input type="checkbox" name="accept_terms" className="mt-0.5 size-4 accent-[#164D38]" aria-invalid={state.fieldErrors?.accept_terms ? true : undefined} />
            <span>Li e aceito os <Link href="/termos" className="text-forest underline">termos de uso</Link> e a <Link href="/privacidade" className="text-forest underline">política de privacidade</Link>.</span>
          </label>
          {state.fieldErrors?.accept_terms ? <p className="text-[13px] text-danger">{state.fieldErrors.accept_terms}</p> : null}
        </div>
      )}
    </AuthForm>
  );
}
