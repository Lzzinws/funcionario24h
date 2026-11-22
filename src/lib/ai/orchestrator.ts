import { AI_CONFIG, estimateCostMicros } from "./config";
import { detectInjection, cleanReply } from "./guardrails";
import { buildSystemPrompt, buildTurnMessage, INJECTION_NOTICE } from "./prompt";
import { allowedTools, toApiTools } from "./tool-schemas";
import { executeTool } from "./executor";
import type { LlmClient, LlmContent } from "./llm";
import type { AiRepository, ConversationContext } from "./types";
import type { ToolName } from "@/lib/employees/tools";

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
  const userText = buildTurnMessage(turnCtx, inboundText, now) + (injection.suspected ? `\n\n${INJECTION_NOTICE}` : "");
  const contents: LlmContent[] = [{ role: "user", parts: [{ text: userText }] }];

  let tokens = 0;
  let costMicros = 0;
  let handoffReason: string | null = null;
  const approvals: string[] = [];
  const toolsUsed: string[] = [];
  let finalText = "";

  for (let step = 0; step <= AI_CONFIG.maxToolSteps; step++) {
    const started = Date.now();
    let turn;
    try {
      turn = await llm.generate({ system, contents, tools, maxOutputTokens: AI_CONFIG.maxOutputTokens });
    } catch (e) {
      const status = (e as { status?: number }).status;
      const retryable = status === 429 || (typeof status === "number" && status >= 500);
      await repo.audit({ orgId: ctx.org.id, employeeId: employee.id, action: "ai.error", entityType: "conversation", entityId: ctx.conversation.id, metadata: { step, retryable, status: status ?? null, error: e instanceof Error ? e.message.slice(0, 300) : "erro desconhecido" } });
      return { status: "error", reason: "Falha ao consultar o modelo de IA.", retryable };
    }

    // 10. Consumo e custo de cada chamada.
    const callCost = estimateCostMicros(turn.usage);
    tokens += turn.usage.input + turn.usage.output;
    costMicros += callCost;
    await repo.recordUsage({ orgId: ctx.org.id, employeeId: employee.id, conversationId: ctx.conversation.id, model: AI_CONFIG.model,
      inputTokens: turn.usage.input, outputTokens: turn.usage.output, costMicros: callCost, latencyMs: Date.now() - started });

    // Filtro de segurança: a resposta não é enviada; a conversa vai para um humano.
    if (turn.blocked) {
      handoffReason = "A resposta da IA foi bloqueada pelos filtros de segurança do modelo.";
      break;
    }

    if (turn.toolCalls.length === 0) {
      finalText = turn.text;
      break;
    }
    if (step === AI_CONFIG.maxToolSteps) {
      finalText = turn.text;
      handoffReason ??= "Limite de ações automáticas por mensagem atingido.";
      break;
    }

    // 7–9. Executa cada ferramenta com verificação de permissão; resultados num único turno.
    contents.push(turn.modelContent);
    const responseParts: NonNullable<LlmContent["parts"]> = [];
    for (const call of turn.toolCalls) {
      const policy = allowed.get(call.name as ToolName) ?? "denied";
      const outcome = await executeTool(call.name, call.args, { repo, ctx, employeeId: employee.id, policy });
      toolsUsed.push(call.name);
      if (outcome.approvalId) approvals.push(outcome.approvalId);
      if (outcome.handoff) handoffReason = outcome.handoff;
      responseParts.push({
        functionResponse: {
          name: call.name,
          ...(call.id ? { id: call.id } : {}),
          response: outcome.isError ? { error: outcome.result } : { result: outcome.result },
        },
      });
    }
    contents.push({ role: "user", parts: responseParts });
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
