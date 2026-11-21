import type { Metadata } from "next";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Criar conta</h1>
      <p className="mb-8 mt-1 text-sm text-sage-dark">7 dias para testar. Sem cartão de crédito.</p>
      <SignUpForm />
    </>
  );
}
