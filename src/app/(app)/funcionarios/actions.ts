"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthorizationError, requireOrg } from "@/lib/auth/session";
import { friendlyDbError, type ActionState } from "@/lib/action-result";
import { fieldErrors } from "@/lib/validation/auth";
import { employeeSchema, parseToolPolicies } from "@/lib/validation/employee";

async function managerCtx() {
  try {
    return { ctx: await requireOrg(["owner", "admin"]) };
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: e.message };
    throw e;
  }
}

/** Cria ou atualiza um funcionário. Instruções alteradas geram nova versão. */
export async function saveEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx, error: authError } = await managerCtx();
  if (!ctx) return { ok: false, message: authError };
  const { supabase, org } = ctx;

  const parsed = employeeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error), message: "Revise os campos destacados." };
  const { instructions, ...data } = parsed.data;
  const { tools, permissions } = parseToolPolicies(form);
  const id = form.get("id")?.toString() || null;

  let employeeId = id;
  if (id) {
    const { error } = await supabase.from("employees").update({ ...data, tools, permissions })
      .eq("id", id).eq("organization_id", org.id);
    if (error) return { ok: false, message: friendlyDbError(error) };
  } else {
    const { count } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("organization_id", org.id);
    if (!ctx.plan || (count ?? 0) >= ctx.plan.max_employees) {
      return { ok: false, message: `Seu plano permite até ${ctx.plan?.max_employees ?? 0} funcionário(s). Exclua um ou mude de plano.` };
    }
    const { data: created, error } = await supabase.from("employees").insert({
      ...data, tools, permissions, organization_id: org.id, is_active: false, is_default: (count ?? 0) === 0,
      template_id: form.get("template_id")?.toString() || null,
    }).select("id").single();
    if (error) return { ok: false, message: friendlyDbError(error) };
    employeeId = created.id;
  }

  const { data: current } = await supabase.from("employee_instructions").select("content")
    .eq("employee_id", employeeId!).eq("is_current", true).maybeSingle();
  if (current?.content !== instructions) {
    const { error } = await supabase.from("employee_instructions").insert({
      organization_id: org.id, employee_id: employeeId!, content: instructions,
    });
    if (error) return { ok: false, message: friendlyDbError(error) };
  }

  revalidatePath("/funcionarios");
  revalidatePath("/painel");
  if (!id) redirect(`/funcionarios/${employeeId}?criado=1`);
  revalidatePath(`/funcionarios/${employeeId}`);
  return { ok: true, message: "Alterações salvas." };
}

/** Ativa/desativa. O banco recusa se ultrapassar o limite do plano. */
export async function setEmployeeActive(id: string, active: boolean): Promise<ActionState> {
  const { ctx, error: authError } = await managerCtx();
  if (!ctx) return { ok: false, message: authError };
  if (active && ctx.org.status === "suspended") return { ok: false, message: "A conta está suspensa." };
  const { error } = await ctx.supabase.from("employees").update({ is_active: active })
    .eq("id", id).eq("organization_id", ctx.org.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/funcionarios");
  revalidatePath(`/funcionarios/${id}`);
  revalidatePath("/painel");
  return { ok: true, message: active ? "Funcionário em serviço." : "Funcionário pausado." };
}

/** Define quem recebe primeiro as novas conversas. */
export async function setDefaultEmployee(id: string): Promise<ActionState> {
  const { ctx, error: authError } = await managerCtx();
  if (!ctx) return { ok: false, message: authError };
  const { supabase, org } = ctx;
  const clear = await supabase.from("employees").update({ is_default: false }).eq("organization_id", org.id).eq("is_default", true);
  if (clear.error) return { ok: false, message: friendlyDbError(clear.error) };
  const { error } = await supabase.from("employees").update({ is_default: true }).eq("id", id).eq("organization_id", org.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/funcionarios");
  revalidatePath(`/funcionarios/${id}`);
  return { ok: true, message: "Novas conversas começarão com este funcionário." };
}

export async function deleteEmployee(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx, error: authError } = await managerCtx();
  if (!ctx) return { ok: false, message: authError };
  const id = String(form.get("id") ?? "");
  const confirmName = String(form.get("confirm_name") ?? "").trim();
  const { data: emp } = await ctx.supabase.from("employees").select("name").eq("id", id).eq("organization_id", ctx.org.id).maybeSingle();
  if (!emp) return { ok: false, message: "Funcionário não encontrado." };
  if (confirmName !== emp.name) return { ok: false, fieldErrors: { confirm_name: `Digite exatamente "${emp.name}" para confirmar.` } };
  const { error } = await ctx.supabase.from("employees").delete().eq("id", id).eq("organization_id", ctx.org.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/funcionarios");
  revalidatePath("/painel");
  redirect("/funcionarios");
}
