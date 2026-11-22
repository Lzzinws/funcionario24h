import { TOOL_DEFS } from "./tool-schemas";
import { localToUtcIso, formatLocal } from "./time";
import { isToolName, TOOL_CATALOG, type ToolName } from "@/lib/employees/tools";
import { formatBRL } from "@/lib/utils";
import type { ToolExecutionContext, ToolOutcome } from "./types";

const ok = (result: unknown): ToolOutcome => ({ result: typeof result === "string" ? result : JSON.stringify(result), isError: false });
const fail = (message: string): ToolOutcome => ({ result: message, isError: true });
const toCents = (brl: number | null) => (brl == null ? null : Math.round(brl * 100));

/**
 * Executa uma chamada de ferramenta pedida pelo modelo.
 * 1. A ferramenta precisa estar na lista permitida do funcionário (allowlist).
 * 2. A entrada é revalidada com zod (nunca confiamos no JSON do modelo).
 * 3. Política "approval": nada é executado — cria-se aprovação + tarefa pendente.
 * 4. Todas as decisões vão para a auditoria.
 */
export async function executeTool(name: string, rawInput: unknown, x: ToolExecutionContext): Promise<ToolOutcome> {
  const { repo, ctx, employeeId, policy } = x;
  const orgId = ctx.org.id;

  if (!isToolName(name) || policy === "denied") {
    await repo.audit({ orgId, employeeId, action: "ai.tool_denied", metadata: { tool: name } });
    return fail(`A ferramenta "${name}" não está autorizada para este funcionário.`);
  }
  const parsed = TOOL_DEFS[name].zod.safeParse(rawInput);
  if (!parsed.success) {
    return fail(`Entrada inválida para ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const input = parsed.data as Record<string, unknown>;

  if (policy === "approval") {
    return requestApproval(name, input, x);
  }

  try {
    const outcome = await runAuto(name, input, x);
    await repo.recordAutoTask({ orgId, employeeId, conversationId: ctx.conversation.id, contactId: ctx.contact.id, tool: name, input, output: outcome.result, ok: !outcome.isError, error: outcome.isError ? outcome.result : undefined });
    await repo.audit({ orgId, employeeId, action: "ai.tool_executed", entityType: "conversation", entityId: ctx.conversation.id, metadata: { tool: name, ok: !outcome.isError } });
    return outcome;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await repo.recordAutoTask({ orgId, employeeId, conversationId: ctx.conversation.id, contactId: ctx.contact.id, tool: name, input, output: null, ok: false, error: msg });
    return fail("Não foi possível concluir esta ação agora. Ofereça transferir para um atendente humano.");
  }
}

async function runAuto(name: ToolName, input: Record<string, unknown>, { repo, ctx, employeeId }: ToolExecutionContext): Promise<ToolOutcome> {
  const orgId = ctx.org.id;
  const source = ctx.conversation.channel === "teste" ? "teste" : "whatsapp";
  switch (name) {
    case "search_knowledge": {
      const hits = await repo.searchKnowledge(orgId, employeeId, String(input.query), 5);
      if (!hits.length) return ok("Nenhuma informação encontrada na base de conhecimento. Não invente: diga que vai verificar ou transfira para um humano.");
      return ok(hits.map((h) => ({ titulo: h.title, categoria: h.category, preco: h.price_cents != null ? formatBRL(h.price_cents) : null, conteudo: h.content.slice(0, 1500) })));
    }
    case "update_contact": {
      const patch: { name?: string; email?: string } = {};
      if (input.name) patch.name = String(input.name);
      if (input.email) patch.email = String(input.email);
      if (!Object.keys(patch).length) return fail("Nenhum dado para atualizar.");
      await repo.updateContact(orgId, ctx.contact.id, patch);
      return ok("Dados do cliente atualizados.");
    }
    case "create_lead": {
      const r = await repo.upsertOpenLead({ orgId, contactId: ctx.contact.id, employeeId, conversationId: ctx.conversation.id, source,
        patch: { interest: String(input.interest), estimated_value_cents: toCents(input.estimated_value_brl as number | null) } });
      return ok(r.created ? "Oportunidade registrada no CRM." : "Oportunidade existente atualizada no CRM.");
    }
    case "update_lead_stage": {
      await repo.upsertOpenLead({ orgId, contactId: ctx.contact.id, employeeId, conversationId: ctx.conversation.id, source,
        patch: { stage: String(input.stage), appendNotes: `Etapa → ${input.stage}: ${input.reason}` } });
      return ok(`Etapa da oportunidade: ${input.stage}.`);
    }
    case "register_negotiation": {
      await repo.upsertOpenLead({ orgId, contactId: ctx.contact.id, employeeId, conversationId: ctx.conversation.id, source,
        patch: { appendNotes: String(input.notes), ...(input.estimated_value_brl != null ? { estimated_value_cents: toCents(input.estimated_value_brl as number) } : {}) } });
      return ok("Negociação registrada no CRM.");
    }
    case "check_availability": {
      const tz = ctx.org.timezone;
      const from = localToUtcIso(`${input.from_date}T00:00`, tz);
      const to = localToUtcIso(`${input.to_date}T23:59`, tz);
      if (new Date(to).getTime() - new Date(from).getTime() > 15 * 864e5 || to < from) return fail("Use um intervalo de até 14 dias.");
      const busy = await repo.listBusySlots(orgId, from, to);
      return ok({
        horario_de_funcionamento: ctx.org.business_hours ?? "não informado — confirme com um humano antes de sugerir horários",
        horarios_ocupados: busy.map((b) => ({ inicio: formatLocal(b.starts_at, tz), fim: b.ends_at ? formatLocal(b.ends_at, tz) : null, situacao: b.status })),
      });
    }
    case "transfer_to_human": {
      return { ...ok("Conversa transferida. Avise o cliente que um atendente humano vai continuar o atendimento."), handoff: String(input.reason) };
    }
    default:
      // Ferramentas sensíveis nunca chegam aqui (sempre "approval").
      return fail("Ação indisponível.");
  }
}

async function requestApproval(name: ToolName, input: Record<string, unknown>, { repo, ctx, employeeId }: ToolExecutionContext): Promise<ToolOutcome> {
  const orgId = ctx.org.id;
  const tz = ctx.org.timezone;
  let actionLabel: string = TOOL_CATALOG[name].label;
  const payload: Record<string, unknown> = { ...input };

  if (name === "request_appointment") {
    const startsAt = localToUtcIso(String(input.starts_at), tz);
    if (new Date(startsAt).getTime() < Date.now()) return fail("O horário pedido já passou. Confirme a data com o cliente.");
    const appointmentId = await repo.createAppointmentRequest({ orgId, contactId: ctx.contact.id, conversationId: ctx.conversation.id, employeeId, service: String(input.service), startsAt, notes: (input.notes as string | null) ?? null });
    payload.appointment_id = appointmentId;
    payload.starts_at_utc = startsAt;
    actionLabel = `Agendar ${input.service} em ${formatLocal(startsAt, tz)}`;
  } else if (name === "schedule_follow_up") {
    payload.when_utc = localToUtcIso(String(input.when), tz);
    actionLabel = `Enviar acompanhamento em ${formatLocal(payload.when_utc as string, tz)}`;
  } else if (name === "request_discount") {
    actionLabel = `Oferecer condição especial: ${input.offer}`;
  }

  const { approvalId } = await repo.createApproval({
    orgId, employeeId, contactId: ctx.contact.id, conversationId: ctx.conversation.id, tool: name,
    actionLabel, justification: String(input.justification ?? "Solicitado pelo cliente"), payload,
  });
  await repo.audit({ orgId, employeeId, action: "ai.approval_requested", entityType: "approval", entityId: approvalId, metadata: { tool: name } });
  return {
    result: "Solicitação registrada e aguardando aprovação humana. NÃO confirme nada ao cliente: diga que o pedido foi recebido e que a equipe vai confirmar em breve.",
    isError: false,
    approvalId,
  };
}
