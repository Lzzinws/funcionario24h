"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE, requireOrg, requireUser } from "@/lib/auth/session";
import { friendlyDbError, type ActionState } from "@/lib/action-result";
import { fieldErrors } from "@/lib/validation/auth";
import { businessInfoSchema, createOrgSchema } from "@/lib/validation/org";
import { knowledgeSchema } from "@/lib/validation/knowledge";
import { effectivePolicy, isToolName } from "@/lib/employees/tools";
import type { EmployeeTemplate } from "@/lib/types";

async function advance(step: number) {
  const { supabase, org } = await requireOrg(["owner", "admin"]);
  if (org.onboarding_step < step) {
    await supabase.from("organizations").update({ onboarding_step: step }).eq("id", org.id);
  }
}

/** Etapa 1 — cadastro da empresa (RPC transacional). */
export async function createOrganization(_: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = createOrgSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name, p_segment: parsed.data.segment, p_plan: parsed.data.plan,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };

  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId as string, { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  await supabase.from("organizations").update({ onboarding_step: 2 }).eq("id", orgId as string);
  redirect("/onboarding?etapa=2");
}

/** Etapa 2 — informações comerciais. */
export async function saveBusinessInfo(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, org } = await requireOrg(["owner", "admin"]);
  const parsed = businessInfoSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { error } = await supabase.from("organizations").update(parsed.data).eq("id", org.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (form.get("intent") === "settings") {
    revalidatePath("/configuracoes");
    return { ok: true, message: "Informações da empresa salvas." };
  }
  await advance(3);
  redirect("/onboarding?etapa=3");
}

/** Etapa 3 — adiciona um produto/serviço à base de conhecimento. */
export async function addOnboardingItem(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, org, userId } = await requireOrg(["owner", "admin"]);
  const parsed = knowledgeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { price, ...rest } = parsed.data;
  const { error } = await supabase.from("knowledge_base").insert({
    ...rest, price_cents: price, organization_id: org.id, created_by: userId,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/onboarding");
  return { ok: true, message: `"${parsed.data.title}" adicionado.` };
}

export async function finishCatalogStep() {
  await advance(4);
  redirect("/onboarding?etapa=4");
}

/** Etapa 4 — cria os funcionários escolhidos a partir dos modelos (inativos até a ativação). */
export async function hireFromTemplates(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, org, plan } = await requireOrg(["owner", "admin"]);
  const chosen = form.getAll("template").map(String);
  if (chosen.length === 0) return { ok: false, message: "Escolha pelo menos um funcionário." };
  if (plan && chosen.length > plan.max_employees) {
    return { ok: false, message: `Seu plano ${plan.name} permite até ${plan.max_employees} funcionário(s). Escolha menos ou mude de plano.` };
  }

  const { data: templates, error: tErr } = await supabase.from("employee_templates").select("*").in("id", chosen);
  if (tErr || !templates?.length) return { ok: false, message: friendlyDbError(tErr) };

  const { data: existing } = await supabase.from("employees").select("template_id").eq("organization_id", org.id);
  const already = new Set((existing ?? []).map((e) => e.template_id));
  const hasDefault = (existing ?? []).length > 0;

  for (const [i, t] of (templates as EmployeeTemplate[]).entries()) {
    if (already.has(t.id)) continue;
    const tools = t.default_tools.filter(isToolName);
    const permissions = Object.fromEntries(tools.map((tool) => [tool, effectivePolicy(tool, t.default_permissions[tool])]));
    const { data: emp, error } = await supabase.from("employees").insert({
      organization_id: org.id, template_id: t.id, role_type: t.role_type, name: t.name, title: t.title,
      personality: t.default_personality, goals: t.default_goals, tools, permissions,
      is_active: false, is_default: !hasDefault && i === 0,
    }).select("id").single();
    if (error) return { ok: false, message: friendlyDbError(error) };
    const ins = await supabase.from("employee_instructions").insert({
      organization_id: org.id, employee_id: emp.id, content: t.default_instructions,
    });
    if (ins.error) return { ok: false, message: friendlyDbError(ins.error) };
  }
  await advance(5);
  redirect("/onboarding?etapa=5");
}

/** Conclui o onboarding (as etapas seguintes são feitas nos módulos). */
export async function completeOnboarding() {
  const { supabase, org } = await requireOrg(["owner", "admin"]);
  await supabase.from("organizations")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", org.id);
  redirect("/painel");
}
