"use server";
import { revalidatePath } from "next/cache";
import { AuthorizationError, requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropicLlm, LlmNotConfiguredError } from "@/lib/ai/llm";
import { runEmployeeTurn } from "@/lib/ai/orchestrator";
import { SupabaseAiRepository } from "@/lib/ai/supabase-repository";
import { aiTestReadiness } from "@/lib/ai/readiness";

const TEST_PHONE = "+0000000000";

export type TestTurnState = {
  ok: boolean;
  message?: string;
  info?: { tools: string[]; approvals: number; handoff: boolean; tokens: number; costUsd: string } | null;
};

/**
 * Envia uma mensagem de teste para um funcionário e executa o orquestrador
 * real (mesmas regras, ferramentas, aprovações e custos do WhatsApp).
 * Registros ficam marcados como canal "teste".
 */
export async function sendTestMessage(employeeId: string, text: string): Promise<TestTurnState> {
  let ctx;
  try { ctx = await requireOrg(["owner", "admin"]); }
  catch (e) { if (e instanceof AuthorizationError) return { ok: false, message: e.message }; throw e; }

  const content = text.trim().slice(0, 4000);
  if (!content) return { ok: false, message: "Escreva uma mensagem." };
  const ready = aiTestReadiness();
  if (!ready.ok) return { ok: false, message: `Configuração pendente no servidor: ${ready.missing.join(", ")}.` };

  // Confirma (via RLS do usuário) que o funcionário é desta empresa.
  const { data: emp } = await ctx.supabase.from("employees").select("id").eq("id", employeeId).eq("organization_id", ctx.org.id).maybeSingle();
  if (!emp) return { ok: false, message: "Funcionário não encontrado." };

  const db = createAdminClient();
  const orgId = ctx.org.id;

  // Contato e conversa de teste (por funcionário).
  const { data: contact, error: cErr } = await db.from("contacts")
    .upsert({ organization_id: orgId, phone_e164: TEST_PHONE, name: "Teste interno", source: "teste" }, { onConflict: "organization_id,phone_e164" })
    .select("id").single();
  if (cErr || !contact) return { ok: false, message: "Não foi possível preparar o teste." };

  let { data: conv } = await db.from("conversations").select("id, status")
    .eq("organization_id", orgId).eq("contact_id", contact.id).eq("employee_id", employeeId).eq("channel", "teste")
    .neq("status", "closed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!conv) {
    const created = await db.from("conversations").insert({ organization_id: orgId, contact_id: contact.id, employee_id: employeeId, channel: "teste" })
      .select("id, status").single();
    if (created.error) return { ok: false, message: "Não foi possível iniciar a conversa de teste." };
    conv = created.data;
  }

  const ins = await db.from("messages").insert({
    organization_id: orgId, conversation_id: conv.id, direction: "inbound", sender_type: "contact", content, status: "received",
  });
  if (ins.error) return { ok: false, message: "Não foi possível registrar a mensagem." };
  await db.from("conversations").update({ last_message_at: new Date().toISOString(), last_inbound_at: new Date().toISOString() })
    .eq("organization_id", orgId).eq("id", conv.id);

  try {
    const result = await runEmployeeTurn({ orgId, conversationId: conv.id }, { repo: new SupabaseAiRepository(db), llm: anthropicLlm() });
    revalidatePath(`/funcionarios/${employeeId}/testar`);
    switch (result.status) {
      case "replied":
        return { ok: true, info: { tools: result.toolsUsed, approvals: result.approvals.length, handoff: result.handoff, tokens: result.tokens, costUsd: (result.costMicros / 1e6).toFixed(4) } };
      case "handoff":
        return { ok: true, message: `Transferido para humano: ${result.reason}`, info: null };
      case "skipped":
        return { ok: false, message: `${result.reason} Reinicie o teste para continuar.` };
      case "error":
        return { ok: false, message: result.retryable ? "O serviço de IA está ocupado. Tente novamente em instantes." : "Não foi possível obter resposta da IA. Verifique a chave da API." };
    }
  } catch (e) {
    if (e instanceof LlmNotConfiguredError) return { ok: false, message: e.message };
    console.error("teste de funcionário:", e);
    return { ok: false, message: "Erro inesperado ao processar o teste." };
  }
}

/** Encerra a conversa de teste atual; a próxima mensagem começa do zero. */
export async function resetTestConversation(employeeId: string): Promise<void> {
  const ctx = await requireOrg(["owner", "admin"]);
  if (!aiTestReadiness().ok) return;
  const db = createAdminClient();
  await db.from("conversations").update({ status: "closed" })
    .eq("organization_id", ctx.org.id).eq("employee_id", employeeId).eq("channel", "teste").neq("status", "closed");
  revalidatePath(`/funcionarios/${employeeId}/testar`);
}
