"use client";
import { useActionState } from "react";
import { initialActionState } from "@/lib/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { cancelSubscription, startCheckout } from "./actions";

export function CheckoutForm({ planId, planName, label, disabled, variant }: {
  planId: string; planName: string; label: string; disabled?: boolean; variant: "primary" | "outline";
}) {
  const [state, action] = useActionState(startCheckout, initialActionState);
  return (
    <form action={action} className="mt-5 grid gap-3">
      <input type="hidden" name="plan_id" value={planId} />
      <p className="text-[13px] text-sage-dark">Você vai entrar com a conta do Mercado Pago que vai pagar na próxima tela.</p>
      <FormMessage state={state} />
      <SubmitButton variant={variant} disabled={disabled} pendingLabel="Abrindo o Mercado Pago…" aria-label={`${label} ${planName}`}>{label}</SubmitButton>
    </form>
  );
}

export function CancelForm() {
  const [state, action] = useActionState(cancelSubscription, initialActionState);
  return (
    <form action={action} className="grid gap-3">
      <Field label='Digite "CANCELAR" para confirmar' htmlFor="confirm" error={state.fieldErrors?.confirm}>
        <Input id="confirm" name="confirm" autoComplete="off" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="danger" pendingLabel="Cancelando…" className="justify-self-start">Cancelar assinatura</SubmitButton>
    </form>
  );
}
