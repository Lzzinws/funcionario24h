import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { canManage, requireOrg } from "@/lib/auth/session";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TOOL_CATALOG, isToolName } from "@/lib/employees/tools";
import { ROLE_TYPES } from "@/lib/validation/employee";
import type { Employee } from "@/lib/types";
import { ActiveToggle } from "./employee-controls";

export const metadata: Metadata = { title: "Funcionários" };
const roleLabel = Object.fromEntries(ROLE_TYPES);

export default async function EmployeesPage() {
  const { supabase, org, plan, role } = await requireOrg();
  const { data, error } = await supabase.from("employees").select("*").eq("organization_id", org.id).order("created_at");
  if (error) throw new Error(error.message);
  const employees = (data ?? []) as Employee[];
  const active = employees.filter((e) => e.is_active).length;
  const manage = canManage(role);
  const atLimit = plan ? employees.length >= plan.max_employees : true;

  return (
    <>
      <PageHeader
        title="Funcionários"
        description={`${active} de ${plan?.max_employees ?? "—"} em serviço no plano ${plan?.name ?? ""}. Cada um tem especialidade, instruções e permissões próprias.`}
        actions={manage && !atLimit ? <Button asChild><Link href="/funcionarios/novo"><Plus aria-hidden />Novo funcionário</Link></Button>
          : manage ? <p className="text-[13px] text-sage-dark">Limite do plano atingido. Exclua um funcionário ou mude de plano para criar outro.</p> : null}
      />
      {employees.length === 0 ? (
        <Card className="grid place-items-center gap-3 px-6 py-16 text-center">
          <p className="font-display text-lg font-semibold">Sua equipe digital está vazia</p>
          <p className="max-w-md text-sm text-sage-dark">Comece com um Atendente para responder dúvidas, ou escolha Vendedor e Agendador conforme o seu negócio.</p>
          {manage ? <Button asChild className="mt-2"><Link href="/funcionarios/novo">Criar primeiro funcionário</Link></Button> : null}
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {employees.map((e) => {
            const tools = e.tools.filter(isToolName);
            const approvals = tools.filter((t) => e.permissions[t] === "approval").length;
            return (
              <li key={e.id}>
                <Card className="flex h-full flex-col">
                  <div className="flex items-start gap-3 p-5">
                    <span className="grid size-11 shrink-0 place-items-center rounded-full font-display text-lg font-semibold" style={{ background: e.color }} aria-hidden>{e.name[0]}</span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/funcionarios/${e.id}`} className="block truncate font-display text-[17px] font-semibold hover:underline">{e.name}</Link>
                      <p className="truncate text-[13px] text-sage-dark">{e.title} · {roleLabel[e.role_type]}</p>
                    </div>
                  </div>
                  <p className="line-clamp-2 px-5 text-[13px] leading-relaxed text-sage-dark">{e.personality || "Sem personalidade definida."}</p>
                  <p className="mt-3 px-5 text-xs text-sage">
                    {tools.length} ferramenta{tools.length === 1 ? "" : "s"}{approvals ? ` · ${approvals} com aprovação` : ""}
                    {tools.length ? ` · ${tools.slice(0, 2).map((t) => TOOL_CATALOG[t].label.toLowerCase()).join(", ")}${tools.length > 2 ? "…" : ""}` : ""}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-line px-5 py-3 pt-3">
                    <Link href={`/funcionarios/${e.id}`} className="text-[13px] font-medium text-forest hover:underline">Configurar</Link>
                    <ActiveToggle id={e.id} name={e.name} active={e.is_active} disabled={!manage} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
