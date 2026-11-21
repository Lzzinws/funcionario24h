"use client";
import { useActionState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";

type FieldDef = {
  name: string; label: string; type?: string; autoComplete?: string; hint?: string; placeholder?: string;
};

/** Formulário genérico de autenticação ligado a uma Server Action. */
export function AuthForm({
  action, fields, submitLabel, pendingLabel, hidden, footer, children,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  fields: FieldDef[];
  submitLabel: string;
  pendingLabel: string;
  hidden?: Record<string, string>;
  footer?: React.ReactNode;
  children?: (state: ActionState) => React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  if (state.ok && state.message) return <FormMessage state={state} />;
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {fields.map((f) => {
        const err = state.fieldErrors?.[f.name];
        return (
          <Field key={f.name} label={f.label} htmlFor={f.name} hint={f.hint} error={err}>
            <Input id={f.name} name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete}
                   placeholder={f.placeholder} aria-invalid={err ? true : undefined}
                   aria-describedby={err ? `${f.name}-error` : f.hint ? `${f.name}-hint` : undefined} required />
          </Field>
        );
      })}
      {children?.(state)}
      <FormMessage state={state} />
      <SubmitButton size="lg" className="w-full" pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
      {footer}
    </form>
  );
}
