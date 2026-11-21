import type { Metadata } from "next";
import { canManage, requireOrg } from "@/lib/auth/session";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBRL } from "@/lib/utils";
import { BusinessInfoForm } from "../../onboarding/forms";

export const metadata: Metadata = { title: "Configurações" };

const SUB_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  trialing: { label: "Período de teste", tone: "success" }, active: { label: "Ativa", tone: "success" },
  past_due: { label: "Pagamento pendente", tone: "warning" }, canceled: { label: "Cancelada", tone: "neutral" },
  suspended: { label: "Suspensa", tone: "danger" },
};
const ROLE: Record<string, string> = { owner: "Proprietário", admin: "Administrador", agent: "Atendente", viewer: "Leitura" };

export default async function SettingsPage() {
  const { supabase, org, role, plan, subscription } = await requireOrg();
  const { data: members } = await supabase.from("organization_members")
    .select("user_id, role, created_at, profiles:user_id(full_name)")
    .eq("organization_id", org.id).order("created_at");
  const st = subscription ? SUB_STATUS[subscription.status] : null;

  return (
    <>
      <PageHeader title="Configurações" description="Dados da empresa, plano e pessoas com acesso." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Informações da empresa" description="Usadas pelos funcionários digitais para se apresentar e responder." />
          <CardBody>
            {canManage(role) ? <BusinessInfoForm org={org} intent="settings" /> : <p className="text-sm text-sage-dark">Somente proprietários e administradores podem editar.</p>}
          </CardBody>
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title="Plano" action={st ? <Badge tone={st.tone}>{st.label}</Badge> : null} />
            <CardBody>
              {plan ? (
                <>
                  <p className="font-display text-2xl font-semibold">{plan.name}</p>
                  <p className="tabular text-sm text-sage-dark">{formatBRL(plan.price_cents)} por mês</p>
                  <ul className="mt-4 grid gap-1.5 text-[13px]">
                    <li>Até {plan.max_employees} funcionário{plan.max_employees > 1 ? "s" : ""} digital{plan.max_employees > 1 ? "is" : ""}</li>
                    <li>{plan.max_whatsapp_numbers} número de WhatsApp</li>
                  </ul>
                  {subscription?.status === "trialing" && subscription.trial_ends_at ? (
                    <p className="mt-4 text-[13px] text-sage-dark">Teste até {new Date(subscription.trial_ends_at).toLocaleDateString("pt-BR")}. A cobrança será habilitada na etapa de assinaturas.</p>
                  ) : null}
                </>
              ) : <p className="text-sm text-sage-dark">Nenhum plano associado.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Pessoas com acesso" />
            <CardBody>
              <ul className="grid gap-3">
                {(members ?? []).map((m) => (
                  <li key={m.user_id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{(m.profiles as unknown as { full_name: string | null } | null)?.full_name ?? "Sem nome"}</span>
                    <Badge>{ROLE[m.role]}</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
