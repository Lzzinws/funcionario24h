"use client";
import { useActionState } from "react";
import { initialActionState } from "@/lib/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { cancelSubscription, startCheckout } from "./actions";

export function CheckoutForm({ planId, planName, defaultEmail, label, disabled, variant }: {
  planId: string; planName: string; defaultEmail: string; label: string; disabled?: boolean; variant: "primary" | "outline";
}) {
  const [state, action] = useActionState(startCheckout, initialActionState);
  const fieldId = `payer_email_${planId}`;
  return (
    <form action={action} className="mt-5 grid gap-3">
      <input type="hidden" name="plan_id" value={planId} />
      <Field label="E-mail do pagador no Mercado Pago" htmlFor={fieldId} error={state.fieldErrors?.payer_email}>
        <Input id={fieldId} name="payer_email" type="email" defaultValue={defaultEmail} required disabled={disabled}
          aria-invalid={state.fieldErrors?.payer_email ? true : undefined} />
      </Field>
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
