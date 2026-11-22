import Anthropic from "@anthropic-ai/sdk";
import { AI_CONFIG, estimateCostMicros, totalInputTokens } from "./config";
import { detectInjection, cleanReply } from "./guardrails";
import { buildSystemPrompt, buildTurnMessage, INJECTION_NOTICE } from "./prompt";
import { allowedTools, toApiTools } from "./tool-schemas";
import { executeTool } from "./executor";
import type { LlmClient } from "./llm";
import type { AiRepository, ConversationContext } from "./types";

export const HANDOFF_MESSAGE =
  "Obrigado pela mensagem! Um atendente da nossa equipe vai continuar o seu atendimento em breve.";

export type TurnResult =
  | { status: "replied"; reply: string; messageId: string; handoff: boolean; approvals: string[]; toolsUsed: string[]; tokens: number; costMicros: number }
  | { status: "handoff"; reply: string; messageId: string; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string; retryable: boolean };

export interface TurnInput {
  orgId: string;
  conversationId: string;
  now?: Date;
}

/**
 * Separa o histórico já respondido das mensagens do cliente que ainda não
 * tiveram resposta (o cliente costuma mandar várias seguidas).
 */
export function splitPending(history: ConversationContext["history"]) {
  let i = history.length;
  while (i > 0 && history[i - 1].direction === "inbound") i--;
  return { answered: history.slice(0, i), pending: history.slice(i) };
}

/**
 * Orquestrador central dos funcionários digitais.
 *
 *  1. Recebe a mensagem            7. Verifica permissões (por ferramenta)
 *  2. Identifica a empresa         8. Decide: responder, executar ou
 *  3. Identifica o cliente            9. pedir aprovação humana
 *  4. Identifica o funcionário    10. Registra atividade, consumo e custo
 *  5. Consulta a base             11. Devolve a resposta (o envio pelo
 *  6. Interpreta (modelo)             WhatsApp é feito por quem chamou)
 */
export async function runEmployeeTurn(input: TurnInput, deps: { repo: AiRepository; llm: LlmClient }): Promise<TurnResult> {
  const { repo, llm } = deps;
  const now = input.now ?? new Date();

  // 2–5. Empresa, cliente, funcionário, base e histórico (tudo escopado à organização).
  const ctx = await repo.loadContext(input.orgId, input.conversationId);
  if (!ctx) return { status: "skipped", reason: "Conversa não encontrada nesta organização." };

  const gate = preflight(ctx);
  if (gate.kind === "skip") return { status: "skipped", reason: gate.reason };
  if (gate.kind === "handoff") return handoff(repo, ctx, gate.reason);

  const employee = ctx.employee!;
  const { answered, pending } = splitPending(ctx.history);
  if (!pending.length) return { status: "skipped", reason: "Nenhuma mensagem nova do cliente." };
  const inboundText = pending.map((m) => m.content).join("\n");
  const turnCtx: ConversationContext = { ...ctx, history: answered };

  // Proteção contra prompt injection: registra e reforça as regras pelo canal do operador.
  const injection = detectInjection(inboundText);
  if (injection.suspected) {
    await repo.audit({ orgId: ctx.org.id, employeeId: employee.id, action: "ai.injection_suspected", entityType: "conversation", entityId: ctx.conversation.id, metadata: { patterns: injection.matches } });
  }

  const allowed = allowedTools(employee.tools, employee.permissions);
  const tools = toApiTools(allowed);
  const system = buildSystemPrompt(ctx);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: buildTurnMessage(turnCtx, inboundText, now) }];
  if (injection.suspected) messages.push({ role: "system", content: INJECTION_NOTICE });

  let tokens = 0;
  let costMicros = 0;
  let handoffReason: string | null = null;
  const approvals: string[] = [];
  const toolsUsed: string[] = [];
  let finalText = "";

  for (let step = 0; step <= AI_CONFIG.maxToolSteps; step++) {
    const started = Date.now();
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await llm.createMessage({
        model: AI_CONFIG.model,
        max_tokens: AI_CONFIG.maxOutputTokens,
        output_config: { effort: AI_CONFIG.effort },
        system,
        tools: tools.length ? tools : undefined,
        messages,
      });
    } catch (e) {
      const retryable = e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError;
      await repo.audit({ orgId: ctx.org.id, employeeId: employee.id, action: "ai.error", entityType: "conversation", entityId: ctx.conversation.id, metadata: { step, retryable, error: e instanceof Error ? e.message.slice(0, 300) : "erro desconhecido" } });
      return { status: "error", reason: "Falha ao consultar o modelo de IA.", retryable };
    }

    // 10. Consumo e custo de cada chamada.
    const callCost = estimateCostMicros(response.model ?? AI_CONFIG.model, response.usage);
    tokens += totalInputTokens(response.usage) + response.usage.output_tokens;
    costMicros += callCost;
    await repo.recordUsage({ orgId: ctx.org.id, employeeId: employee.id, conversationId: ctx.conversation.id, model: response.model ?? AI_CONFIG.model,
      inputTokens: totalInputTokens(response.usage), outputTokens: response.usage.output_tokens, costMicros: callCost, latencyMs: Date.now() - started });

    if (response.stop_reason === "refusal") {
      handoffReason = "O modelo de IA recusou responder a esta mensagem.";
      break;
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      finalText = text;
      if (!finalText && response.stop_reason === "max_tokens") handoffReason = "A resposta da IA excedeu o limite de tamanho.";
      break;
    }
    if (step === AI_CONFIG.maxToolSteps) {
      finalText = text;
      handoffReason ??= "Limite de ações automáticas por mensagem atingido.";
      break;
    }

    // 7–9. Executa cada ferramenta com verificação de permissão; resultados num único turno.
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of toolUses) {
      const policy = allowed.get(call.name as never) ?? "denied";
      const outcome = await executeTool(call.name, call.input, { repo, ctx, employeeId: employee.id, policy });
      toolsUsed.push(call.name);
      if (outcome.approvalId) approvals.push(outcome.approvalId);
      if (outcome.handoff) handoffReason = outcome.handoff;
      results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.result, is_error: outcome.isError || undefined });
    }
    messages.push({ role: "user", content: results });
  }

  const reply = cleanReply(finalText);
  if (!reply) {
    return handoff(repo, ctx, handoffReason ?? "A IA não produziu uma resposta.", { tokens, costMicros });
  }

  // 11. Registra a resposta (o envio pelo canal é responsabilidade de quem chamou).
  const messageId = await repo.saveOutboundMessage({
    orgId: ctx.org.id, conversationId: ctx.conversation.id, employeeId: employee.id, content: reply,
    status: ctx.conversation.channel === "teste" ? "sent" : "queued",
  });
  await repo.updateConversation(ctx.org.id, ctx.conversation.id, {
    last_message_at: new Date().toISOString(),
    employee_id: ctx.conversation.employee_id ?? employee.id,
    ...(ctx.conversation.first_response_seconds == null ? { first_response_seconds: firstResponseSeconds(ctx, now) } : {}),
    ...(handoffReason ? { status: "waiting_human", handoff_reason: handoffReason } : {}),
  });
  await repo.audit({ orgId: ctx.org.id, employeeId: employee.id, action: handoffReason ? "ai.replied_and_transferred" : "ai.replied", entityType: "conversation", entityId: ctx.conversation.id,
    metadata: { tools: toolsUsed, approvals: approvals.length, tokens, cost_micros: costMicros, handoff: handoffReason } });

  return { status: "replied", reply, messageId, handoff: !!handoffReason, approvals, toolsUsed, tokens, costMicros };
}

type Gate = { kind: "ok" } | { kind: "skip"; reason: string } | { kind: "handoff"; reason: string };

/** Regras que impedem a IA de responder, avaliadas antes de qualquer custo. */
export function preflight(ctx: ConversationContext): Gate {
  if (ctx.org.status !== "active") return { kind: "skip", reason: "Conta suspensa." };
  if (!ctx.subscriptionActive) return { kind: "skip", reason: "Assinatura inativa." };
  if (ctx.contact.opted_out_at) return { kind: "skip", reason: "Cliente pediu para não receber mensagens." };
  if (ctx.conversation.status !== "open") return { kind: "skip", reason: "Conversa em atendimento humano ou encerrada." };
  if (!ctx.employee) return { kind: "handoff", reason: "Nenhum funcionário digital disponível." };
  // No canal de teste o funcionário pode estar pausado (teste antes da ativação).
  if (!ctx.employee.is_active && ctx.conversation.channel !== "teste") return { kind: "handoff", reason: "O funcionário responsável está pausado." };
  if (ctx.plan && ctx.monthTokensUsed >= ctx.plan.monthly_ai_tokens) return { kind: "handoff", reason: "Franquia mensal de IA do plano esgotada." };
  return { kind: "ok" };
}

async function handoff(repo: AiRepository, ctx: ConversationContext, reason: string, usage?: { tokens: number; costMicros: number }): Promise<TurnResult> {
  const messageId = await repo.saveOutboundMessage({
    orgId: ctx.org.id, conversationId: ctx.conversation.id, employeeId: null, content: HANDOFF_MESSAGE,
    status: ctx.conversation.channel === "teste" ? "sent" : "queued",
  });
  await repo.updateConversation(ctx.org.id, ctx.conversation.id, { status: "waiting_human", handoff_reason: reason, last_message_at: new Date().toISOString() });
  await repo.audit({ orgId: ctx.org.id, employeeId: ctx.employee?.id ?? null, action: "ai.handoff", entityType: "conversation", entityId: ctx.conversation.id, metadata: { reason, ...usage } });
  return { status: "handoff", reply: HANDOFF_MESSAGE, messageId, reason };
}

function firstResponseSeconds(ctx: ConversationContext, now: Date): number {
  const firstInbound = ctx.history.find((m) => m.direction === "inbound")?.created_at ?? ctx.conversation.created_at;
  return Math.max(0, Math.round((now.getTime() - new Date(firstInbound).getTime()) / 1000));
}
