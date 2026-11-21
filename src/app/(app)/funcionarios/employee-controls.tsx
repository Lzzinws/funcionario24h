"use client";
import { useActionState, useState, useTransition } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Star } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-result";
import { deleteEmployee, setDefaultEmployee, setEmployeeActive } from "./actions";

export function ActiveToggle({ id, name, active, disabled }: { id: string; name: string; active: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [checked, setChecked] = useState(active);
  const [result, setResult] = useState<ActionState | null>(null);
  return (
    <div className="grid justify-items-end gap-1">
      <label className="flex items-center gap-2 text-[13px] text-sage-dark">
        {checked ? "Em serviço" : "Pausado"}
        <Switch checked={checked} disabled={disabled || pending} aria-label={`${checked ? "Pausar" : "Colocar em serviço"} ${name}`}
          onCheckedChange={(v) => {
            setChecked(v);
            start(async () => {
              const r = await setEmployeeActive(id, v);
              setResult(r);
              if (!r.ok) setChecked(!v);
            });
          }} />
      </label>
      {result && !result.ok ? <p role="alert" className="max-w-64 text-right text-xs text-danger">{result.message}</p> : null}
    </div>
  );
}

export function DefaultButton({ id, isDefault }: { id: string; isDefault: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionState | null>(null);
  if (isDefault) return <span className="inline-flex items-center gap-1.5 text-[13px] text-forest"><Star className="size-4 fill-mint text-forest" aria-hidden />Recebe as novas conversas</span>;
  return (
    <div>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => setMsg(await setDefaultEmployee(id)))}>
        <Star aria-hidden /> Receber novas conversas
      </Button>
      {msg && !msg.ok ? <p role="alert" className="mt-1 text-xs text-danger">{msg.message}</p> : null}
    </div>
  );
}

export function DeleteEmployee({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState(deleteEmployee, initialActionState);
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild><Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft">Excluir {name}</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none">
          <Dialog.Title className="font-display text-lg font-semibold">Excluir {name}?</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-sage-dark">
            O histórico de conversas é mantido, mas as instruções e configurações deste funcionário serão apagadas. Não é possível desfazer.
          </Dialog.Description>
          <form action={action} className="mt-5 grid gap-4">
            <input type="hidden" name="id" value={id} />
            <Field label={`Digite "${name}" para confirmar`} htmlFor="confirm_name" error={state.fieldErrors?.confirm_name}>
              <Input id="confirm_name" name="confirm_name" autoComplete="off" />
            </Field>
            <FormMessage state={state} />
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button variant="outline" type="button">Manter funcionário</Button></Dialog.Close>
              <SubmitButton variant="danger" pendingLabel="Excluindo…">Excluir {name}</SubmitButton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
