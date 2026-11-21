import Link from "next/link";
import type { Metadata } from "next";
import { Check } from "lucide-react";
import { getOrgContext, requireUser } from "@/lib/auth/session";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/utils";
import type { Employee, EmployeeTemplate, KnowledgeItem, Plan } from "@/lib/types";
import { BusinessInfoForm, CreateOrgForm, HireForm, QuickItemForm } from "./forms";
import { completeOnboarding, finishCatalogStep } from "./actions";

export const metadata: Metadata = { title: "Configurar empresa" };

const STEPS = [
  "Cadastro da empresa", "Informações comerciais", "Produtos e serviços", "Seleção dos funcionários",
  "Personalidades", "Permissões", "Conexão com WhatsApp", "Teste de funcionamento", "Ativação",
];

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ etapa?: string }> }) {
  const { supabase } = await requireUser();
  const ctx = await getOrgContext();
  const requested = Number((await searchParams).etapa ?? "0");
  const reached = ctx ? ctx.org.onboarding_step : 1;
  const step = ctx ? Math.min(Math.max(requested || reached, 2), Math.min(reached, 5)) : 1;

  let body: React.ReactNode;
  let title = STEPS[step - 1];
  let lead = "";

  if (step === 1) {
    const { data: plans } = await supabase.from("plans").select("*").eq("is_active", true).order("sort_order");
    lead = "Comece pelo básico. Você poderá alterar tudo depois.";
    body = <CreateOrgForm plans={(plans ?? []) as Plan[]} />;
  } else if (step === 2) {
    lead = "Seus funcionários digitais usam estas informações para responder com precisão.";
    body = <BusinessInfoForm org={ctx!.org} />;
  } else if (step === 3) {
    const { data: items } = await ctx!.supabase.from("knowledge_base").select("id, title, category, price_cents")
      .eq("organization_id", ctx!.org.id).order("created_at");
    lead = "Cadastre o que você vende. Nada é inventado: preços e serviços vêm somente daqui.";
    body = (
      <div className="grid gap-6">
        {items && items.length > 0 ? (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {(items as Pick<KnowledgeItem, "id" | "title" | "category" | "price_cents">[]).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span className="min-w-0 truncate">{i.title}</span>
                <span className="tabular shrink-0 text-sage-dark">{i.price_cents != null ? formatBRL(i.price_cents) : i.category}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <QuickItemForm />
        <form action={finishCatalogStep} className="border-t border-line pt-5">
          <Button type="submit" variant={items?.length ? "primary" : "ghost"}>
            {items?.length ? "Continuar" : "Pular por enquanto"}
          </Button>
        </form>
      </div>
    );
  } else if (step === 4) {
    const [{ data: templates }, { data: hired }] = await Promise.all([
      ctx!.supabase.from("employee_templates").select("*").order("sort_order"),
      ctx!.supabase.from("employees").select("template_id").eq("organization_id", ctx!.org.id),
    ]);
    lead = "Escolha quem vai trabalhar com você. Cada um tem especialidade e regras próprias.";
    body = <HireForm templates={(templates ?? []) as EmployeeTemplate[]} hired={(hired ?? []).map((h) => h.template_id as string)} maxEmployees={ctx!.plan?.max_employees ?? 1} />;
  } else {
    const { data: employees } = await ctx!.supabase.from("employees").select("id, name, title")
      .eq("organization_id", ctx!.org.id).order("created_at");
    title = "Personalize sua equipe";
    lead = "Ajuste a personalidade, as instruções e o que cada funcionário pode fazer sozinho. Depois conecte o WhatsApp, teste e ative.";
    body = (
      <div className="grid gap-6">
        <ul className="grid gap-2">
          {(employees as Pick<Employee, "id" | "name" | "title">[] | null ?? []).map((e) => (
            <li key={e.id}>
              <Link href={`/funcionarios/${e.id}`} className="flex items-center justify-between rounded-lg border border-line bg-white px-4 py-3 text-sm hover:border-sage/60">
                <span><span className="font-medium">{e.name}</span> <span className="text-sage-dark">· {e.title}</span></span>
                <span className="text-forest">Configurar</span>
              </Link>
            </li>
          ))}
        </ul>
        <form action={completeOnboarding}>
          <Button type="submit">Ir para o painel</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white px-4 py-4 sm:px-8"><Logo /></header>
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Etapas da configuração">
          <ol className="grid gap-1 text-sm max-lg:flex max-lg:gap-1.5 max-lg:overflow-x-auto">
            {STEPS.map((s, i) => {
              const n = i + 1, done = n < reached || (n === 1 && !!ctx), current = n === step;
              return (
                <li key={s} className={`flex items-center gap-3 rounded-md px-2 py-1.5 max-lg:shrink-0 ${current ? "bg-white font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-sage-dark"}`} aria-current={current ? "step" : undefined}>
                  <span className={`tabular grid size-5 shrink-0 place-items-center rounded-full text-[11px] ${done ? "bg-forest text-white" : current ? "bg-mint text-ink" : "bg-ink/5"}`}>
                    {done ? <Check className="size-3" aria-label="concluída" /> : n}
                  </span>
                  <span className="max-lg:sr-only">{s}</span>
                </li>
              );
            })}
          </ol>
        </nav>
        <section className="min-w-0">
          <p className="tabular text-[13px] text-sage-dark">Etapa {Math.min(step, 9)} de 9</p>
          <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight tracking-tight">{title}</h1>
          <p className="mb-8 mt-2 max-w-xl text-[15px] leading-relaxed text-sage-dark">{lead}</p>
          {body}
        </section>
      </div>
    </div>
  );
}
