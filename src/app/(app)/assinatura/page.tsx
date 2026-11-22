import type { Metadata } from "next";
import { CheckCircle2, FlaskConical } from "lucide-react";
import { requireOrg } from "@/lib/auth/session";
import { billingConfig } from "@/lib/billing/config";
import { effectiveState, type EffectiveState } from "@/lib/billing/state";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatBRL } from "@/lib/utils";
import type { Plan } from "@/lib/types";
import { CancelForm, CheckoutForm } from "./billing-forms";
import { syncCheckout } from "./actions";

export const metadata: Metadata = { title: "Plano e cobrança" };
export const dynamic = "force-dynamic";

const STATE: Record<EffectiveState, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  trial: { label: "Período de teste", tone: "success" },
  trial_expired: { label: "Teste encerrado", tone: "danger" },
  active: { label: "Ativa", tone: "success" },
  canceling: { label: "Cancelada — ativa até o fim do período", tone: "warning" },
  past_due: { label: "Pagamento pendente", tone: "warning" },
  inactive: { label: "Inativa", tone: "danger" },
};
const PAYMENT_STATUS: Record<string, string> = {
  approved: "Aprovado", pending: "Pendente", in_process: "Em análise", rejected: "Recusado",
  cancelled: "Cancelado", canceled: "Cancelado", refunded: "Estornado", charged_back: "Contestado", authorized: "Autorizado",
};
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  if (checkout) await syncCheckout(checkout); // retorno do Mercado Pago: confirma o estado na hora

  const ctx = await requireOrg();
  const { supabase, org, role, subscription: sub, plan: currentPlan, userEmail } = ctx;
  const cfg = billingConfig();
  const owner = role === "owner";
  const state = effectiveState(sub);

  const [{ data: plans }, { data: payments }, { data: lastCheckout }] = await Promise.all([
    supabase.from("plans").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("billing_payments").select("id, amount_cents, status, paid_at, created_at, mode").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(24),
    checkout
      ? supabase.from("billing_checkouts").select("status, plan_id").eq("id", checkout).eq("organization_id", org.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const paidSub = !!sub?.provider_subscription_id && (state === "active" || state === "past_due");

  return (
    <>
      <PageHeader title="Plano e cobrança" description="Assinatura mensal pelo Mercado Pago. Você pode trocar de plano ou cancelar quando quiser." />

      {cfg.ready && cfg.mode === "test" ? (
        <p role="status" className="mb-6 flex items-start gap-2 rounded-md bg-amber-soft px-4 py-3 text-sm text-amber">
          <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
          Modo de teste: as cobranças usam contas de teste do Mercado Pago e nenhum valor real é cobrado.
        </p>
      ) : null}
      {!cfg.ready ? (
        <p role="status" className="mb-6 rounded-md bg-amber-soft px-4 py-3 text-sm text-amber">
          A contratação online será liberada assim que os pagamentos forem configurados no servidor.
        </p>
      ) : null}
      {lastCheckout ? (
        <p role="status" className={cn("mb-6 rounded-md px-4 py-3 text-sm", lastCheckout.status === "authorized" ? "bg-mint-soft text-forest" : "bg-paper text-ink shadow-[0_0_0_1px_var(--color-line)]")}>
          {lastCheckout.status === "authorized"
            ? "Pagamento confirmado. Seu novo plano já está ativo."
            : lastCheckout.status === "pending"
              ? "Ainda não recebemos a confirmação do Mercado Pago. Assim que o pagamento for aprovado, o plano é ativado automaticamente."
              : "A contratação não foi concluída. Você pode tentar novamente."}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid content-start gap-6">
          <div className="grid gap-4 md:grid-cols-3">
            {((plans ?? []) as Plan[]).map((p) => {
              const isCurrent = currentPlan?.id === p.id && (state === "active" || state === "past_due");
              const label = isCurrent ? "Plano atual" : state === "active" || state === "past_due" ? `Mudar para ${p.name}` : `Assinar ${p.name}`;
              return (
                <Card key={p.id} className={cn("flex flex-col p-5", isCurrent && "border-forest")}>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-lg font-semibold">{p.name}</h2>
                    {isCurrent ? <Badge tone="success"><CheckCircle2 className="size-3" aria-hidden />Atual</Badge> : null}
                  </div>
                  <p className="tabular mt-2 font-display text-2xl font-semibold">{formatBRL(p.price_cents)}<span className="text-sm font-normal text-sage-dark">/mês</span></p>
                  <p className="mt-1 text-[13px] text-sage-dark">Até {p.max_employees} funcionário{p.max_employees > 1 ? "s" : ""} · {p.max_whatsapp_numbers} WhatsApp</p>
                  {owner && !isCurrent ? (
                    <CheckoutForm planId={p.id} planName={p.name} defaultEmail={userEmail ?? ""} label={label} disabled={!cfg.ready} variant={p.id === "profissional" ? "primary" : "outline"} />
                  ) : null}
                </Card>
              );
            })}
          </div>
          {!owner ? <p className="text-sm text-sage-dark">Somente o proprietário da empresa pode contratar ou cancelar planos.</p> : null}
          <p className="text-[13px] text-sage-dark">Ao trocar de plano, a assinatura anterior é cancelada automaticamente após a aprovação da nova. Se o novo plano tiver menos funcionários, os excedentes são pausados.</p>

          <Card>
            <CardHeader title="Pagamentos" description="Cobranças recebidas do Mercado Pago" />
            <CardBody className="p-0">
              {payments?.length ? (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-sage-dark"><th className="px-5 py-2 font-medium">Data</th><th className="px-5 py-2 font-medium">Valor</th><th className="px-5 py-2 font-medium">Situação</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-5 py-3">{date(p.paid_at ?? p.created_at)}</td>
                        <td className="tabular px-5 py-3">{formatBRL(p.amount_cents)}</td>
                        <td className="px-5 py-3"><Badge tone={p.status === "approved" ? "success" : p.status === "rejected" ? "danger" : "neutral"}>{PAYMENT_STATUS[p.status] ?? p.status}</Badge>{p.mode === "test" ? <span className="ml-2 text-xs text-sage">teste</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="px-5 pb-5 text-sm text-sage-dark">Nenhuma cobrança ainda.</p>}
            </CardBody>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title="Sua assinatura" action={<Badge tone={STATE[state].tone}>{STATE[state].label}</Badge>} />
            <CardBody className="grid gap-2 text-sm">
              <p><span className="text-sage-dark">Plano:</span> {currentPlan?.name ?? "—"}</p>
              {state === "trial" || state === "trial_expired" ? <p><span className="text-sage-dark">Teste até:</span> {date(sub?.trial_ends_at)}</p> : null}
              {paidSub ? <p><span className="text-sage-dark">Pago até:</span> {date(sub?.current_period_end)}</p> : null}
              {state === "canceling" ? <p><span className="text-sage-dark">Acesso até:</span> {date(sub?.cancel_at)}</p> : null}
              {state === "past_due" ? <p className="text-amber">O Mercado Pago não conseguiu cobrar a última fatura e tentará novamente. Verifique o cartão cadastrado.</p> : null}
              {state === "trial_expired" ? <p className="text-danger">Seus funcionários digitais estão pausados. Assine um plano para reativá-los.</p> : null}
            </CardBody>
          </Card>
          {owner && paidSub ? (
            <Card>
              <CardHeader title="Cancelar assinatura" description="Sem multa. O acesso continua até o fim do período pago." />
              <CardBody><CancelForm /></CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
