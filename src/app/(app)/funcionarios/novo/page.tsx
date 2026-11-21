import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canManage, requireOrg } from "@/lib/auth/session";
import { PageHeader } from "@/components/app/page-header";
import { isToolName, effectivePolicy } from "@/lib/employees/tools";
import { cn } from "@/lib/utils";
import type { EmployeeTemplate } from "@/lib/types";
import { EmployeeForm, type EmployeeFormValues } from "../employee-form";

export const metadata: Metadata = { title: "Novo funcionário" };

export default async function NewEmployeePage({ searchParams }: { searchParams: Promise<{ modelo?: string }> }) {
  const { supabase, role, org, plan } = await requireOrg();
  if (!canManage(role)) redirect("/funcionarios");
  const { count } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("organization_id", org.id);
  if (!plan || (count ?? 0) >= plan.max_employees) redirect("/funcionarios");
  const { modelo } = await searchParams;
  const { data } = await supabase.from("employee_templates").select("*").order("sort_order");
  const templates = (data ?? []) as EmployeeTemplate[];
  const t = templates.find((x) => x.id === (modelo ?? templates[0]?.id));
  const blank = modelo === "personalizado";

  const initial: EmployeeFormValues = t && !blank
    ? {
        template_id: t.id, name: t.name, title: t.title, role_type: t.role_type, color: "#65D69B",
        personality: t.default_personality, goals: t.default_goals, instructions: t.default_instructions,
        permissions: Object.fromEntries(t.default_tools.filter(isToolName).map((k) => [k, effectivePolicy(k, t.default_permissions[k])])),
      }
    : { name: "", title: "", role_type: "personalizado", color: "#9BD3F0", personality: "", goals: [], instructions: "", permissions: { search_knowledge: "auto", transfer_to_human: "auto" } };

  const options = [...templates.map((x) => ({ id: x.id, label: x.title })), { id: "personalizado", label: "Do zero" }];
  const selected = blank ? "personalizado" : t?.id;

  return (
    <>
      <PageHeader title="Novo funcionário" description="Comece de um modelo pronto e ajuste o que quiser. Ele é criado pausado." />
      <nav aria-label="Modelos" className="mb-6 flex flex-wrap gap-2">
        {options.map((o) => (
          <Link key={o.id} href={`/funcionarios/novo?modelo=${o.id}`} aria-current={selected === o.id ? "true" : undefined}
            className={cn("rounded-full border px-3.5 py-1.5 text-[13px] transition-colors", selected === o.id ? "border-forest bg-forest text-white" : "border-line bg-white hover:border-sage/60")}>
            {o.label}
          </Link>
        ))}
      </nav>
      <EmployeeForm key={selected} initial={initial} canEdit />
    </>
  );
}
