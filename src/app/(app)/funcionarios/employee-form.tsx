"use client";
import { useActionState } from "react";
import { ShieldCheck } from "lucide-react";
import { initialActionState } from "@/lib/action-result";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { TOOL_CATALOG, TOOL_NAMES } from "@/lib/employees/tools";
import { EMPLOYEE_COLORS, ROLE_TYPES } from "@/lib/validation/employee";
import { cn } from "@/lib/utils";
import type { ToolPolicy } from "@/lib/types";
import { saveEmployee } from "./actions";

export type EmployeeFormValues = {
  id?: string;
  template_id?: string | null;
  name: string;
  title: string;
  role_type: string;
  color: string;
  personality: string;
  goals: string[];
  instructions: string;
  permissions: Record<string, ToolPolicy>;
};

const POLICY_LABEL: Record<ToolPolicy, string> = { auto: "Sozinho", approval: "Com aprovação", denied: "Não pode" };

export function EmployeeForm({ initial, canEdit, instructionsVersion }: { initial: EmployeeFormValues; canEdit: boolean; instructionsVersion?: number }) {
  const [state, action] = useActionState(saveEmployee, initialActionState);
  const fe = state.fieldErrors ?? {};
  const inv = (n: string) => (fe[n] ? { "aria-invalid": true as const, "aria-describedby": `${n}-error` } : {});

  return (
    <form action={action} className="grid gap-6" noValidate>
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {initial.template_id ? <input type="hidden" name="template_id" value={initial.template_id} /> : null}
      <fieldset disabled={!canEdit} className="grid gap-6">
        <Card>
          <CardHeader title="Identidade" description="Como o funcionário se apresenta aos clientes." />
          <CardBody className="grid gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Nome" htmlFor="name" error={fe.name}>
                <Input id="name" name="name" defaultValue={initial.name} maxLength={60} {...inv("name")} />
              </Field>
              <Field label="Cargo" htmlFor="title" error={fe.title}>
                <Input id="title" name="title" defaultValue={initial.title} maxLength={80} {...inv("title")} />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Especialidade" htmlFor="role_type">
                <NativeSelect id="role_type" name="role_type" defaultValue={initial.role_type}>
                  {ROLE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </NativeSelect>
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium">Cor de identificação</legend>
                <div className="flex gap-2">
                  {EMPLOYEE_COLORS.map((c) => (
                    <label key={c} className="cursor-pointer">
                      <input type="radio" name="color" value={c} defaultChecked={initial.color === c} className="peer sr-only" />
                      <span className="block size-8 rounded-full ring-offset-2 peer-checked:ring-2 peer-checked:ring-forest peer-focus-visible:ring-2 peer-focus-visible:ring-mint" style={{ background: c }} />
                      <span className="sr-only">{c}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <Field label="Personalidade" htmlFor="personality" hint="Tom de voz e jeito de falar. Ex.: cordial, direta, usa frases curtas.">
              <Textarea id="personality" name="personality" defaultValue={initial.personality} maxLength={2000} className="min-h-20" />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Instruções e objetivos"
            description={instructionsVersion ? `Versão ${instructionsVersion}. Cada alteração cria uma nova versão, e o histórico fica registrado.` : "O que este funcionário deve fazer e o que nunca deve fazer."} />
          <CardBody className="grid gap-5">
            <Field label="Instruções" htmlFor="instructions" error={fe.instructions}
              hint="Mensagens de clientes nunca alteram estas instruções.">
              <Textarea id="instructions" name="instructions" defaultValue={initial.instructions} maxLength={8000} className="min-h-40" {...inv("instructions")} />
            </Field>
            <Field label="Objetivos" htmlFor="goals" hint="Um por linha, até 8. Usados para medir o desempenho.">
              <Textarea id="goals" name="goals" defaultValue={initial.goals.join("\n")} className="min-h-24" />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Ferramentas e permissões" description="Defina o que pode ser feito sozinho e o que precisa da sua aprovação." />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {TOOL_NAMES.map((tool) => {
                const meta = TOOL_CATALOG[tool];
                const current = initial.permissions[tool] ?? "denied";
                const options: ToolPolicy[] = meta.sensitive ? ["approval", "denied"] : ["auto", "approval", "denied"];
                return (
                  <li key={tool} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {meta.label}
                        {meta.sensitive ? <span className="inline-flex items-center gap-1 text-xs font-normal text-amber"><ShieldCheck className="size-3.5" aria-hidden />sempre com aprovação</span> : null}
                      </p>
                      <p className="mt-0.5 text-[13px] text-sage-dark">{meta.description}</p>
                    </div>
                    <fieldset className="inline-flex rounded-md border border-line bg-paper p-0.5" aria-label={`Permissão: ${meta.label}`}>
                      {options.map((p) => (
                        <label key={p} className="cursor-pointer">
                          <input type="radio" name={`tool:${tool}`} value={p} defaultChecked={current === p || (meta.sensitive && current === "auto" && p === "approval")} className="peer sr-only" />
                          <span className={cn("block rounded px-3 py-1.5 text-[13px] text-sage-dark transition-colors peer-checked:bg-white peer-checked:text-ink peer-checked:shadow-[0_0_0_1px_var(--color-line)] peer-focus-visible:ring-2 peer-focus-visible:ring-mint")}>
                            {POLICY_LABEL[p]}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </fieldset>

      {canEdit ? (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
          <SubmitButton pendingLabel="Salvando…">{initial.id ? "Salvar alterações" : "Criar funcionário"}</SubmitButton>
          <div className="min-w-0 flex-1"><FormMessage state={state} /></div>
        </div>
      ) : (
        <p className="text-sm text-sage-dark">Somente proprietários e administradores podem alterar funcionários.</p>
      )}
    </form>
  );
}
