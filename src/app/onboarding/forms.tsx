"use client";
import { useActionState, useRef, useEffect } from "react";
import { initialActionState } from "@/lib/action-result";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { SEGMENTS } from "@/lib/validation/org";
import { KNOWLEDGE_CATEGORIES } from "@/lib/validation/knowledge";
import { formatBRL } from "@/lib/utils";
import type { EmployeeTemplate, Organization, Plan } from "@/lib/types";
import { addOnboardingItem, createOrganization, hireFromTemplates, saveBusinessInfo } from "./actions";

function err(state: { fieldErrors?: Record<string, string> }, name: string) {
  const e = state.fieldErrors?.[name];
  return { error: e, inputProps: { "aria-invalid": e ? true : undefined, "aria-describedby": e ? `${name}-error` : undefined } };
}

export function CreateOrgForm({ plans }: { plans: Plan[] }) {
  const [state, action] = useActionState(createOrganization, initialActionState);
  const name = err(state, "name"), segment = err(state, "segment");
  return (
    <form action={action} className="grid gap-5" noValidate>
      <Field label="Nome da empresa" htmlFor="name" error={name.error}>
        <Input id="name" name="name" autoComplete="organization" required {...name.inputProps} />
      </Field>
      <Field label="Segmento" htmlFor="segment" error={segment.error} hint="Usamos para sugerir respostas e funcionários adequados.">
        <NativeSelect id="segment" name="segment" defaultValue="" required {...segment.inputProps}>
          <option value="" disabled>Selecione</option>
          {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </NativeSelect>
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-[13px] font-medium">Plano</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {plans.map((p, i) => (
            <label key={p.id} className="relative cursor-pointer rounded-md border border-line bg-white p-3.5 transition-colors has-[:checked]:border-forest has-[:checked]:bg-mint-soft/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-mint">
              <input type="radio" name="plan" value={p.id} defaultChecked={i === 0} className="sr-only" />
              <span className="block font-display text-[15px] font-semibold">{p.name}</span>
              <span className="tabular mt-1 block text-sm text-ink">{formatBRL(p.price_cents)}<span className="text-sage-dark">/mês</span></span>
              <span className="mt-1 block text-xs text-sage-dark">Até {p.max_employees} funcionário{p.max_employees > 1 ? "s" : ""}</span>
            </label>
          ))}
        </div>
        <p className="text-[13px] text-sage-dark">Você testa grátis por 7 dias e pode trocar de plano depois.</p>
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingLabel="Criando empresa…">Criar empresa</SubmitButton>
    </form>
  );
}

export function BusinessInfoForm({ org, intent = "onboarding" }: { org: Organization; intent?: "onboarding" | "settings" }) {
  const [state, action] = useActionState(saveBusinessInfo, initialActionState);
  const website = err(state, "website");
  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name="intent" value={intent} />
      <Field label="O que sua empresa faz" htmlFor="description" hint="Duas ou três frases. Os funcionários usam isso para se apresentar.">
        <Textarea id="description" name="description" defaultValue={org.description ?? ""} maxLength={2000} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Horário de atendimento" htmlFor="business_hours" hint="Ex.: seg a sex, 8h às 18h; sáb, 8h às 12h">
          <Input id="business_hours" name="business_hours" defaultValue={org.business_hours ?? ""} />
        </Field>
        <Field label="Telefone comercial" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={org.phone ?? ""} />
        </Field>
      </div>
      <Field label="Endereço" htmlFor="address">
        <Input id="address" name="address" autoComplete="street-address" defaultValue={org.address ?? ""} />
      </Field>
      <Field label="Site" htmlFor="website" error={website.error}>
        <Input id="website" name="website" type="url" placeholder="https://" defaultValue={org.website ?? ""} {...website.inputProps} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Salvando…" className="justify-self-start">
        {intent === "onboarding" ? "Salvar e continuar" : "Salvar informações"}
      </SubmitButton>
    </form>
  );
}

export function QuickItemForm() {
  const [state, action] = useActionState(addOnboardingItem, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) formRef.current?.reset(); }, [state]);
  const title = err(state, "title"), price = err(state, "price");
  return (
    <form ref={formRef} action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="is_published" value="on" />
      <div className="grid gap-4 sm:grid-cols-[160px_1fr_140px]">
        <Field label="Tipo" htmlFor="category">
          <NativeSelect id="category" name="category" defaultValue="servico">
            {KNOWLEDGE_CATEGORIES.filter(([v]) => ["produto", "servico", "faq", "politica"].includes(v)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Nome" htmlFor="title" error={title.error}>
          <Input id="title" name="title" required {...title.inputProps} />
        </Field>
        <Field label="Preço (R$)" htmlFor="price" error={price.error}>
          <Input id="price" name="price" inputMode="decimal" placeholder="opcional" {...price.inputProps} />
        </Field>
      </div>
      <Field label="Descrição" htmlFor="content" hint="O que está incluso, duração, condições. Os funcionários só falam o que estiver aqui.">
        <Textarea id="content" name="content" className="min-h-20" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="outline" pendingLabel="Adicionando…" className="justify-self-start">Adicionar item</SubmitButton>
    </form>
  );
}

export function HireForm({ templates, hired, maxEmployees }: { templates: EmployeeTemplate[]; hired: string[]; maxEmployees: number }) {
  const [state, action] = useActionState(hireFromTemplates, initialActionState);
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        {templates.map((t) => (
          <label key={t.id} className="group relative flex cursor-pointer flex-col rounded-lg border border-line bg-white p-4 transition-colors has-[:checked]:border-forest has-[:checked]:bg-mint-soft/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-mint">
            <input type="checkbox" name="template" value={t.id} defaultChecked={hired.includes(t.id) || templates.length === 1} disabled={hired.includes(t.id)} className="absolute right-4 top-4 size-4 accent-[#164D38]" />
            <span className="text-[13px] text-sage-dark">{t.title}</span>
            <span className="font-display text-lg font-semibold">{t.name}</span>
            <span className="mt-2 text-[13px] leading-relaxed text-sage-dark">{t.description}</span>
            {hired.includes(t.id) ? <span className="mt-3 text-xs font-medium text-forest">Já está na sua equipe</span> : null}
          </label>
        ))}
      </div>
      <p className="text-[13px] text-sage-dark">Seu plano permite até {maxEmployees} funcionário{maxEmployees > 1 ? "s" : ""}. Eles começam desativados — você ativa depois de revisar.</p>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Montando equipe…" className="justify-self-start">Montar minha equipe</SubmitButton>
    </form>
  );
}
