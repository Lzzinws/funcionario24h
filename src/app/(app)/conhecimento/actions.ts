"use server";
import { revalidatePath } from "next/cache";
import { AuthorizationError, requireOrg } from "@/lib/auth/session";
import { friendlyDbError, type ActionState } from "@/lib/action-result";
import { fieldErrors } from "@/lib/validation/auth";
import { knowledgeSchema } from "@/lib/validation/knowledge";

async function ctxOrError() {
  try { return { ctx: await requireOrg(["owner", "admin"]) }; }
  catch (e) { if (e instanceof AuthorizationError) return { error: e.message }; throw e; }
}

export async function saveKnowledge(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx, error: authError } = await ctxOrError();
  if (!ctx) return { ok: false, message: authError };
  const parsed = knowledgeSchema.safeParse({ ...Object.fromEntries(form), is_published: form.get("is_published") ?? "off" });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { price, ...rest } = parsed.data;

  // Restrição opcional por funcionário: vazio = todos podem consultar.
  const employeeIds = form.getAll("allowed_employee_ids").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  const restrict = form.get("restrict") === "on";
  const row = { ...rest, price_cents: price, allowed_employee_ids: restrict ? employeeIds : null };
  if (restrict && employeeIds.length === 0) return { ok: false, message: "Escolha ao menos um funcionário ou libere para todos." };

  const id = form.get("id")?.toString();
  const { error } = id
    ? await ctx.supabase.from("knowledge_base").update(row).eq("id", id).eq("organization_id", ctx.org.id)
    : await ctx.supabase.from("knowledge_base").insert({ ...row, organization_id: ctx.org.id, created_by: ctx.userId });
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/conhecimento");
  return { ok: true, message: id ? "Item atualizado." : `"${rest.title}" adicionado à base.` };
}

export async function deleteKnowledge(id: string): Promise<ActionState> {
  const { ctx, error: authError } = await ctxOrError();
  if (!ctx) return { ok: false, message: authError };
  const { error } = await ctx.supabase.from("knowledge_base").delete().eq("id", id).eq("organization_id", ctx.org.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  revalidatePath("/conhecimento");
  return { ok: true, message: "Item removido." };
}
