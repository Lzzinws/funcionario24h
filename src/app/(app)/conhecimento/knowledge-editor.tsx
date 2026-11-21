"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { initialActionState } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { KNOWLEDGE_CATEGORIES } from "@/lib/validation/knowledge";
import type { KnowledgeItem } from "@/lib/types";
import { deleteKnowledge, saveKnowledge } from "./actions";

type Emp = { id: string; name: string };

/** Painel lateral para criar/editar um item da base. */
export function KnowledgeSheet({ item, employees, trigger }: { item?: KnowledgeItem; employees: Emp[]; trigger: "new" | "edit" }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveKnowledge, initialActionState);
  const [restrict, setRestrict] = useState(!!item?.allowed_employee_ids);
  useEffect(() => { if (state.ok) setOpen(false); }, [state]);
  const fe = state.fieldErrors ?? {};

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        {trigger === "new"
          ? <Button><Plus aria-hidden />Adicionar item</Button>
          : <Button variant="ghost" size="icon" aria-label={`Editar ${item?.title}`} title="Editar"><Pencil aria-hidden /></Button>}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(34rem,100vw)] flex-col bg-white shadow-xl focus:outline-none">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <Dialog.Title className="font-display text-lg font-semibold">{item ? "Editar item" : "Novo item da base"}</Dialog.Title>
            <Dialog.Close className="grid size-9 place-items-center rounded-md hover:bg-ink/5" aria-label="Fechar"><X className="size-5" /></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Informações que os funcionários digitais podem consultar.</Dialog.Description>
          <form action={action} className="flex flex-1 flex-col overflow-hidden" noValidate>
            {item ? <input type="hidden" name="id" value={item.id} /> : null}
            <div className="grid flex-1 content-start gap-5 overflow-y-auto px-6 py-5">
              <div className="grid gap-5 sm:grid-cols-[1fr_150px]">
                <Field label="Categoria" htmlFor="category">
                  <NativeSelect id="category" name="category" defaultValue={item?.category ?? "servico"}>
                    {KNOWLEDGE_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Preço (R$)" htmlFor="price" error={fe.price}>
                  <Input id="price" name="price" inputMode="decimal" placeholder="opcional"
                    defaultValue={item?.price_cents != null ? (item.price_cents / 100).toFixed(2).replace(".", ",") : ""} aria-invalid={fe.price ? true : undefined} />
                </Field>
              </div>
              <Field label="Título" htmlFor="title" error={fe.title}>
                <Input id="title" name="title" defaultValue={item?.title} maxLength={200} aria-invalid={fe.title ? true : undefined} />
              </Field>
              <Field label="Conteúdo" htmlFor="content" error={fe.content} hint="Escreva como explicaria a um novo colaborador. Os funcionários digitais respondem somente com base nisto.">
                <Textarea id="content" name="content" defaultValue={item?.content} className="min-h-48" maxLength={20000} />
              </Field>
              <label className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" name="is_published" defaultChecked={item?.is_published ?? true} className="size-4 accent-[#164D38]" />
                Disponível para consulta dos funcionários
              </label>
              {employees.length > 1 ? (
                <fieldset className="grid gap-2 rounded-md border border-line p-4">
                  <legend className="px-1 text-[13px] font-medium">Quem pode consultar</legend>
                  <label className="flex items-center gap-2.5 text-sm">
                    <input type="checkbox" name="restrict" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} className="size-4 accent-[#164D38]" />
                    Restringir a funcionários específicos
                  </label>
                  {restrict ? employees.map((e) => (
                    <label key={e.id} className="ml-6 flex items-center gap-2.5 text-sm">
                      <input type="checkbox" name="allowed_employee_ids" value={e.id} defaultChecked={item?.allowed_employee_ids?.includes(e.id)} className="size-4 accent-[#164D38]" />
                      {e.name}
                    </label>
                  )) : null}
                </fieldset>
              ) : null}
            </div>
            <div className="grid gap-3 border-t border-line px-6 py-4">
              <FormMessage state={state.ok ? initialActionState : state} />
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild><Button type="button" variant="outline">Cancelar</Button></Dialog.Close>
                <SubmitButton pendingLabel="Salvando…">{item ? "Salvar item" : "Adicionar item"}</SubmitButton>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DeleteKnowledgeButton({ id, title }: { id: string; title: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <>
      <Button variant="ghost" size="icon" disabled={pending} aria-label={`Remover ${title}`} title="Remover"
        onClick={() => {
          if (!window.confirm(`Remover "${title}" da base? Os funcionários deixarão de usar esta informação.`)) return;
          start(async () => { const r = await deleteKnowledge(id); if (!r.ok) setError(r.message); });
        }}>
        <Trash2 aria-hidden />
      </Button>
      {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
    </>
  );
}
