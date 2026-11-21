import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, Circle } from "lucide-react";
import { requireOrg, canManage } from "@/lib/auth/session";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DayClock } from "@/components/app/day-clock";
import { ActivityChart } from "@/components/app/activity-chart";
import { auditLabel } from "@/lib/audit-labels";
import { cn, formatCompact, formatDuration, formatNumber, formatRelative } from "@/lib/utils";
import type { AuditLog, DashboardStats, Employee } from "@/lib/types";

export const metadata: Metadata = { title: "Painel" };

export default async function DashboardPage() {
  const ctx = await requireOrg();
  const { supabase, org, plan, role } = ctx;

  const [statsRes, employeesRes, auditRes, kbRes] = await Promise.all([
    supabase.rpc("org_dashboard_stats", { p_org: org.id, p_days: 30 }),
    supabase.from("employees").select("id, name, title, is_active, color, role_type").eq("organization_id", org.id).order("created_at"),
    canManage(role)
      ? supabase.from("audit_logs").select("id, actor_type, action, entity_type, metadata, created_at").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] as AuditLog[], error: null }),
    supabase.from("knowledge_base").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
  ]);
  if (statsRes.error) throw new Error(`Falha ao carregar indicadores: ${statsRes.error.message}`);

  const s = statsRes.data as DashboardStats;
  const employees = (employeesRes.data ?? []) as Pick<Employee, "id" | "name" | "title" | "is_active" | "color" | "role_type">[];
  const audit = (auditRes.data ?? []) as AuditLog[];
  const tokens = Number(s.ai_input_tokens) + Number(s.ai_output_tokens);
  const quota = plan?.monthly_ai_tokens ?? 0;
  const usagePct = quota ? Math.min(100, Math.round((tokens / quota) * 100)) : 0;

  const setup = [
    { done: !!org.description, label: "Descrever a empresa", href: "/configuracoes" },
    { done: (kbRes.count ?? 0) > 0, label: "Cadastrar produtos e serviços", href: "/conhecimento" },
    { done: employees.length > 0, label: "Montar a equipe digital", href: "/funcionarios" },
    { done: s.employees_active > 0, label: "Ativar pelo menos um funcionário", href: "/funcionarios" },
  ];
  const pendingSetup = setup.filter((x) => !x.done).length;

  const kpis = [
    { label: "Conversas", value: formatNumber(s.conversations), note: `${s.conversations_open} em andamento` },
    { label: "Leads capturados", value: formatNumber(s.leads), note: "oportunidades, não vendas" },
    { label: "Tarefas executadas", value: formatNumber(s.tasks_done), note: "pelos funcionários" },
    { label: "Tempo de 1ª resposta", value: formatDuration(s.avg_first_response_seconds), note: "média" },
  ];

  return (
    <>
      <PageHeader title={org.name} description="Últimos 30 dias da sua equipe digital." />

      {pendingSetup > 0 ? (
        <Card className="mb-6 border-forest/20">
          <CardHeader title="Deixe sua equipe pronta para atender" description={`${setup.length - pendingSetup} de ${setup.length} passos concluídos. A conexão com o WhatsApp é liberada na próxima etapa da plataforma.`} />
          <CardBody>
            <ul className="grid gap-2 sm:grid-cols-2">
              {setup.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className={cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-paper", item.done && "text-sage-dark")}>
                    {item.done ? <CheckCircle2 className="size-[18px] text-forest" aria-label="concluído" /> : <Circle className="size-[18px] text-sage" aria-label="pendente" />}
                    <span className={item.done ? "line-through decoration-sage/50" : ""}>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-6">
          <Card>
            <dl className="grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
              {kpis.map((k, i) => (
                <div key={k.label} className={cn("p-5", i < 2 && "max-md:border-b max-md:border-line", i % 2 === 0 && "max-md:border-r max-md:border-line")}>
                  <dt className="text-[13px] text-sage-dark">{k.label}</dt>
                  <dd className="tabular mt-1 font-display text-[28px] font-semibold leading-none tracking-tight">{k.value}</dd>
                  <dd className="mt-1.5 text-xs text-sage">{k.note}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Movimento diário" description="Mensagens trocadas e conversas novas, últimos 14 dias" />
            <CardBody className="pt-3"><ActivityChart data={s.daily} /></CardBody>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader title="Aprovações pendentes" description="Ações que aguardam sua decisão" />
              <CardBody>
                <p className="tabular font-display text-[40px] font-semibold leading-none">{s.approvals_pending}</p>
                <p className="mt-2 text-[13px] text-sage-dark">
                  {s.approvals_pending ? "Nenhuma delas é executada antes da sua autorização." : "Tudo em dia. Descontos, agendamentos e contatos ativos aparecerão aqui."}
                </p>
                {s.waiting_human ? <Badge tone="warning" className="mt-3">{s.waiting_human} conversa(s) aguardando um humano</Badge> : null}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Consumo de IA" description={plan ? `Franquia do plano ${plan.name}` : "Sem plano ativo"} />
              <CardBody>
                <p className="tabular font-display text-[40px] font-semibold leading-none">{usagePct}%</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/5" role="progressbar" aria-valuenow={usagePct} aria-valuemin={0} aria-valuemax={100} aria-label="Uso da franquia de IA">
                  <div className={cn("h-full rounded-full", usagePct > 85 ? "bg-danger" : "bg-mint")} style={{ width: `${Math.max(usagePct, tokens ? 2 : 0)}%` }} />
                </div>
                <p className="tabular mt-2 text-[13px] text-sage-dark">{formatCompact(tokens)} de {formatCompact(quota)} tokens nos últimos 30 dias</p>
              </CardBody>
            </Card>
          </div>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title="Sua equipe ao longo do dia" description="Mensagens por hora, últimos 7 dias" />
            <CardBody><DayClock hourly={s.hourly} /></CardBody>
          </Card>

          <Card>
            <CardHeader title="Equipe" description={`${s.employees_active} de ${plan?.max_employees ?? "—"} em serviço`}
              action={<Link href="/funcionarios" className="text-[13px] font-medium text-forest hover:underline">Gerenciar</Link>} />
            <CardBody>
              {employees.length ? (
                <ul className="grid gap-3">
                  {employees.map((e) => (
                    <li key={e.id} className="flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-full font-display text-sm font-semibold text-ink" style={{ background: e.color }} aria-hidden>{e.name[0]}</span>
                      <Link href={`/funcionarios/${e.id}`} className="min-w-0 flex-1 hover:underline">
                        <span className="block truncate text-sm font-medium">{e.name}</span>
                        <span className="block truncate text-xs text-sage-dark">{e.title}</span>
                      </Link>
                      <Badge tone={e.is_active ? "success" : "neutral"}>
                        {e.is_active ? <span className="on-duty size-1.5 rounded-full bg-mint" aria-hidden /> : null}
                        {e.is_active ? "Em serviço" : "Pausado"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-sage-dark">Ninguém contratado ainda. <Link href="/funcionarios/novo" className="font-medium text-forest hover:underline">Criar funcionário</Link></p>
              )}
            </CardBody>
          </Card>

          {canManage(role) ? (
            <Card>
              <CardHeader title="Atividades recentes" />
              <CardBody>
                {audit.length ? (
                  <ol className="grid gap-3">
                    {audit.map((a) => (
                      <li key={a.id} className="flex justify-between gap-3 text-[13px]">
                        <span className="min-w-0 truncate">{auditLabel(a.action)}</span>
                        <time dateTime={a.created_at} className="shrink-0 text-sage">{formatRelative(a.created_at)}</time>
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-sage-dark">As ações da equipe aparecerão aqui.</p>}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
