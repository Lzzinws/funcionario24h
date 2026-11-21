import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { canManage, requireOrg } from "@/lib/auth/session";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCompact, formatNumber, formatRelative } from "@/lib/utils";
import type { Employee } from "@/lib/types";
import { EmployeeForm } from "../employee-form";
import { ActiveToggle, DefaultButton, DeleteEmployee } from "../employee-controls";

export const metadata: Metadata = { title: "Funcionário" };

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criado?: string }> }) {
  const { id } = await params;
  const { criado } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, org, role } = await requireOrg();
  const { data: emp } = await supabase.from("employees").select("*").eq("id", id).eq("organization_id", org.id).maybeSingle();
  if (!emp) notFound();
  const e = emp as Employee;
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);

  const [history, conversations, sent, tasks, leads, pendingApprovals, usage] = await Promise.all([
    supabase.from("employee_instructions").select("id, version, created_at, is_current, content").eq("employee_id", id).order("version", { ascending: false }).limit(10),
    count(supabase.from("conversations").select("id", { count: "exact", head: true }).eq("employee_id", id).gte("created_at", since)),
    count(supabase.from("messages").select("id", { count: "exact", head: true }).eq("employee_id", id).eq("direction", "outbound").gte("created_at", since)),
    count(supabase.from("tasks").select("id", { count: "exact", head: true }).eq("employee_id", id).eq("status", "done").gte("created_at", since)),
    count(supabase.from("leads").select("id", { count: "exact", head: true }).eq("employee_id", id).gte("created_at", since)),
    count(supabase.from("approvals").select("id", { count: "exact", head: true }).eq("employee_id", id).eq("status", "pending")),
    supabase.from("usage_records").select("input_tokens, output_tokens").eq("employee_id", id).gte("created_at", since),
  ]);
  const versions = history.data ?? [];
  const current = versions.find((v) => v.is_current);
  const tokens = (usage.data ?? []).reduce((a, u) => a + u.input_tokens + u.output_tokens, 0);
  const manage = canManage(role);

  const perf = [
    ["Conversas", formatNumber(conversations)], ["Mensagens enviadas", formatNumber(sent)],
    ["Tarefas concluídas", formatNumber(tasks)], ["Leads gerados", formatNumber(leads)],
    ["Aprovações pendentes", formatNumber(pendingApprovals)], ["Tokens de IA", formatCompact(tokens)],
  ];

  return (
    <>
      <Link href="/funcionarios" className="mb-4 inline-flex items-center gap-1 text-[13px] text-sage-dark hover:text-ink"><ChevronLeft className="size-4" aria-hidden />Funcionários</Link>
      <div className="mb-8 flex flex-wrap items-start gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-full font-display text-2xl font-semibold" style={{ background: e.color }} aria-hidden>{e.name[0]}</span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">{e.name}</h1>
          <p className="text-[15px] text-sage-dark">{e.title}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {manage ? <DefaultButton id={e.id} isDefault={e.is_default} /> : e.is_default ? <Badge tone="success">Recebe as novas conversas</Badge> : null}
          <ActiveToggle id={e.id} name={e.name} active={e.is_active} disabled={!manage} />
        </div>
      </div>
      {criado ? <p role="status" className="mb-6 rounded-md bg-mint-soft px-4 py-3 text-sm text-forest">{e.name} foi criado e está pausado. Revise as permissões e coloque em serviço quando quiser.</p> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <EmployeeForm canEdit={manage} instructionsVersion={current?.version}
          initial={{ id: e.id, name: e.name, title: e.title, role_type: e.role_type, color: e.color, personality: e.personality,
                     goals: e.goals, instructions: current?.content ?? "", permissions: e.permissions }} />
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title="Desempenho" description="Últimos 30 dias" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                {perf.map(([l, v]) => (
                  <div key={l}><dt className="text-xs text-sage-dark">{l}</dt><dd className="tabular font-display text-xl font-semibold">{v}</dd></div>
                ))}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Histórico de instruções" />
            <CardBody>
              {versions.length ? (
                <ol className="grid gap-2.5 text-[13px]">
                  {versions.map((v) => (
                    <li key={v.id} className="flex justify-between gap-2">
                      <span>Versão {v.version}{v.is_current ? <span className="text-forest"> · atual</span> : null}</span>
                      <time className="text-sage" dateTime={v.created_at}>{formatRelative(v.created_at)}</time>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-sage-dark">Sem instruções salvas.</p>}
            </CardBody>
          </Card>
          {manage ? <div><DeleteEmployee id={e.id} name={e.name} /></div> : null}
        </div>
      </div>
    </>
  );
}
