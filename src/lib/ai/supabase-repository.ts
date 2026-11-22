import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiRepository, ConversationContext, KnowledgeSnippet } from "./types";

/**
 * Repositório do orquestrador sobre o Supabase com service_role.
 * O service_role ignora RLS, por isso TODA consulta aqui filtra por
 * organization_id explicitamente — nunca remova esses filtros.
 */
export class SupabaseAiRepository implements AiRepository {
  constructor(private db: SupabaseClient) {}

  private check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data;
  }

  /** Para inserts/selects que obrigatoriamente retornam uma linha. */
  private one<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
    const data = this.check(res, what);
    if (data == null) throw new Error(`${what}: nenhum registro retornado`);
    return data as NonNullable<T>;
  }

  async loadContext(orgId: string, conversationId: string): Promise<ConversationContext | null> {
    const conv = this.check(await this.db.from("conversations")
      .select("id, status, channel, employee_id, first_response_seconds, created_at, contact_id")
      .eq("organization_id", orgId).eq("id", conversationId).maybeSingle(), "conversa");
    if (!conv) return null;

    const [org, contact, sub, history] = await Promise.all([
      this.db.from("organizations").select("id, name, segment, description, address, business_hours, phone, website, timezone, status").eq("id", orgId).single(),
      this.db.from("contacts").select("id, name, phone_e164, email, opted_out_at").eq("organization_id", orgId).eq("id", conv.contact_id).single(),
      this.db.from("subscriptions").select("status, plans(monthly_ai_tokens)").eq("organization_id", orgId).maybeSingle(),
      this.db.from("messages").select("direction, sender_type, content, created_at")
        .eq("organization_id", orgId).eq("conversation_id", conversationId)
        .order("created_at", { ascending: false }).limit(40),
    ]);

    // Funcionário responsável pela conversa; se não houver, o padrão da empresa.
    let employee = null;
    if (conv.employee_id) {
      employee = this.check(await this.db.from("employees").select("id, name, title, role_type, personality, goals, tools, permissions, is_active")
        .eq("organization_id", orgId).eq("id", conv.employee_id).maybeSingle(), "funcionário");
    }
    if (!employee) {
      const { data } = await this.db.from("employees").select("id, name, title, role_type, personality, goals, tools, permissions, is_active")
        .eq("organization_id", orgId).eq("is_active", true).order("is_default", { ascending: false }).order("created_at").limit(1);
      employee = data?.[0] ?? null;
    }

    const [instructions, knowledge, monthTokens] = employee
      ? await Promise.all([
          this.db.from("employee_instructions").select("content").eq("organization_id", orgId).eq("employee_id", employee.id).eq("is_current", true).maybeSingle(),
          this.db.from("knowledge_base").select("id, category, title, content, price_cents")
            .eq("organization_id", orgId).eq("is_published", true)
            .or(`allowed_employee_ids.is.null,allowed_employee_ids.cs.{${employee.id}}`)
            .order("category").order("title").limit(200),
          this.db.rpc("org_month_ai_tokens", { p_org: orgId }),
        ])
      : [{ data: null }, { data: [] }, { data: 0 }];

    const s = sub.data as { status: string; plans: { monthly_ai_tokens: number } | null } | null;
    return {
      org: this.check(org, "organização"),
      conversation: conv,
      contact: this.check(contact, "contato"),
      employee,
      instructions: (instructions.data as { content: string } | null)?.content ?? null,
      knowledge: (knowledge.data ?? []) as KnowledgeSnippet[],
      history: (this.check(history, "histórico") ?? []).reverse(),
      plan: s?.plans ?? null,
      subscriptionActive: !!s && ["trialing", "active", "past_due"].includes(s.status),
      monthTokensUsed: Number(monthTokens.data ?? 0),
    } as ConversationContext;
  }

  async saveOutboundMessage(a: Parameters<AiRepository["saveOutboundMessage"]>[0]) {
    const row = this.one(await this.db.from("messages").insert({
      organization_id: a.orgId, conversation_id: a.conversationId, direction: "outbound",
      sender_type: a.employeeId ? "employee" : "system", employee_id: a.employeeId,
      content: a.content.slice(0, 8000), status: a.status, status_updated_at: new Date().toISOString(),
    }).select("id").single(), "salvar resposta");
    return row.id as string;
  }

  async updateConversation(orgId: string, conversationId: string, patch: Record<string, unknown>) {
    this.check(await this.db.from("conversations").update(patch).eq("organization_id", orgId).eq("id", conversationId), "atualizar conversa");
  }

  async recordUsage(a: Parameters<AiRepository["recordUsage"]>[0]) {
    this.check(await this.db.from("usage_records").insert({
      organization_id: a.orgId, employee_id: a.employeeId, conversation_id: a.conversationId, kind: "ai_tokens",
      model: a.model, input_tokens: a.inputTokens, output_tokens: a.outputTokens, cost_micros: a.costMicros, latency_ms: a.latencyMs,
    }), "registrar consumo");
  }

  async audit(a: Parameters<AiRepository["audit"]>[0]) {
    // Auditoria nunca deve derrubar o atendimento: falhas são apenas logadas.
    const { error } = await this.db.from("audit_logs").insert({
      organization_id: a.orgId, actor_type: "employee", actor_id: a.employeeId, action: a.action,
      entity_type: a.entityType ?? null, entity_id: a.entityId ?? null, metadata: a.metadata ?? {},
    });
    if (error) console.error("audit_logs:", error.message);
  }

  async searchKnowledge(orgId: string, employeeId: string, query: string, limit: number) {
    const res = await this.db.from("knowledge_base").select("id, category, title, content, price_cents")
      .eq("organization_id", orgId).eq("is_published", true)
      .or(`allowed_employee_ids.is.null,allowed_employee_ids.cs.{${employeeId}}`)
      .textSearch("search", query, { type: "websearch", config: "portuguese" }).limit(limit);
    return this.check(res, "busca na base") as KnowledgeSnippet[];
  }

  async updateContact(orgId: string, contactId: string, patch: { name?: string; email?: string }) {
    this.check(await this.db.from("contacts").update(patch).eq("organization_id", orgId).eq("id", contactId), "atualizar contato");
  }

  async upsertOpenLead(a: Parameters<AiRepository["upsertOpenLead"]>[0]) {
    const { data: open } = await this.db.from("leads").select("id, notes")
      .eq("organization_id", a.orgId).eq("contact_id", a.contactId).not("stage", "in", "(ganho,perdido)")
      .order("created_at", { ascending: false }).limit(1);
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const fields: Record<string, unknown> = { last_interaction_at: new Date().toISOString() };
    if (a.patch.interest) fields.interest = a.patch.interest;
    if (a.patch.stage) fields.stage = a.patch.stage;
    if (a.patch.estimated_value_cents !== undefined) fields.estimated_value_cents = a.patch.estimated_value_cents;

    if (open?.[0]) {
      if (a.patch.appendNotes) fields.notes = [open[0].notes, `[${stamp}] ${a.patch.appendNotes}`].filter(Boolean).join("\n").slice(-8000);
      this.check(await this.db.from("leads").update(fields).eq("organization_id", a.orgId).eq("id", open[0].id), "atualizar lead");
      return { id: open[0].id as string, created: false };
    }
    const row = this.one(await this.db.from("leads").insert({
      ...fields, organization_id: a.orgId, contact_id: a.contactId, employee_id: a.employeeId, conversation_id: a.conversationId,
      source: a.source, title: (a.patch.interest ?? "Oportunidade").slice(0, 120),
      notes: a.patch.appendNotes ? `[${stamp}] ${a.patch.appendNotes}` : null,
    }).select("id").single(), "criar lead");
    return { id: row.id as string, created: true };
  }

  async listBusySlots(orgId: string, fromIso: string, toIso: string) {
    const res = await this.db.from("appointments").select("starts_at, ends_at, service, status")
      .eq("organization_id", orgId).neq("status", "cancelled").gte("starts_at", fromIso).lte("starts_at", toIso)
      .order("starts_at").limit(100);
    return this.check(res, "agenda") ?? [];
  }

  async createAppointmentRequest(a: Parameters<AiRepository["createAppointmentRequest"]>[0]) {
    const row = this.one(await this.db.from("appointments").insert({
      organization_id: a.orgId, contact_id: a.contactId, conversation_id: a.conversationId, employee_id: a.employeeId,
      service: a.service, starts_at: a.startsAt, notes: a.notes, status: "pending_approval",
    }).select("id").single(), "criar agendamento");
    return row.id as string;
  }

  async createApproval(r: Parameters<AiRepository["createApproval"]>[0]) {
    const rows = this.check(await this.db.rpc("create_ai_approval", {
      p_org: r.orgId, p_employee: r.employeeId, p_contact: r.contactId, p_conversation: r.conversationId,
      p_tool: r.tool, p_label: r.actionLabel, p_justification: r.justification, p_payload: r.payload,
    }), "criar aprovação") as { approval_id: string; task_id: string }[];
    return { approvalId: rows[0].approval_id, taskId: rows[0].task_id };
  }

  async recordAutoTask(a: Parameters<AiRepository["recordAutoTask"]>[0]) {
    const { error } = await this.db.from("tasks").insert({
      organization_id: a.orgId, employee_id: a.employeeId, conversation_id: a.conversationId, contact_id: a.contactId,
      tool: a.tool, input: a.input ?? {}, output: a.output == null ? null : { result: a.output },
      status: a.ok ? "done" : "failed", error: a.error?.slice(0, 1000) ?? null,
      executed_at: new Date().toISOString(), requires_approval: false,
    });
    if (error) console.error("tasks:", error.message);
  }
}
