import type { Employee, Organization, ToolPolicy } from "@/lib/types";

export interface ContextMessage {
  direction: "inbound" | "outbound";
  sender_type: "contact" | "employee" | "human" | "system";
  content: string;
  created_at: string;
}

export interface KnowledgeSnippet {
  id: string;
  category: string;
  title: string;
  content: string;
  price_cents: number | null;
}

export interface ConversationContext {
  org: Pick<Organization, "id" | "name" | "segment" | "description" | "address" | "business_hours" | "phone" | "website" | "timezone" | "status">;
  conversation: { id: string; status: "open" | "waiting_human" | "human" | "closed"; channel: "whatsapp" | "teste"; employee_id: string | null; first_response_seconds: number | null; created_at: string };
  contact: { id: string; name: string | null; phone_e164: string; email: string | null; opted_out_at: string | null };
  employee: Pick<Employee, "id" | "name" | "title" | "role_type" | "personality" | "goals" | "tools" | "permissions" | "is_active"> | null;
  instructions: string | null;
  /** Base de conhecimento publicada e permitida para o funcionário. */
  knowledge: KnowledgeSnippet[];
  /** Mensagens mais recentes primeiro NÃO: ordem cronológica. */
  history: ContextMessage[];
  plan: { monthly_ai_tokens: number } | null;
  subscriptionActive: boolean;
  monthTokensUsed: number;
}

export interface BusySlot { starts_at: string; ends_at: string | null; service: string; status: string }

export interface ApprovalRequest {
  orgId: string;
  employeeId: string;
  contactId: string;
  conversationId: string;
  tool: string;
  actionLabel: string;
  justification: string;
  payload: Record<string, unknown>;
}

/** Acesso a dados do orquestrador. Implementações DEVEM restringir tudo à organização. */
export interface AiRepository {
  loadContext(orgId: string, conversationId: string): Promise<ConversationContext | null>;
  saveOutboundMessage(args: { orgId: string; conversationId: string; employeeId: string | null; content: string; status: "queued" | "sent" }): Promise<string>;
  updateConversation(orgId: string, conversationId: string, patch: Record<string, unknown>): Promise<void>;
  recordUsage(args: { orgId: string; employeeId: string | null; conversationId: string; model: string; inputTokens: number; outputTokens: number; costMicros: number; latencyMs: number }): Promise<void>;
  audit(args: { orgId: string; employeeId: string | null; action: string; entityType?: string; entityId?: string | null; metadata?: Record<string, unknown> }): Promise<void>;
  searchKnowledge(orgId: string, employeeId: string, query: string, limit: number): Promise<KnowledgeSnippet[]>;
  updateContact(orgId: string, contactId: string, patch: { name?: string; email?: string }): Promise<void>;
  upsertOpenLead(args: { orgId: string; contactId: string; employeeId: string; conversationId: string; source: string; patch: { interest?: string; stage?: string; estimated_value_cents?: number | null; appendNotes?: string } }): Promise<{ id: string; created: boolean }>;
  listBusySlots(orgId: string, fromIso: string, toIso: string): Promise<BusySlot[]>;
  createAppointmentRequest(args: { orgId: string; contactId: string; conversationId: string; employeeId: string; service: string; startsAt: string; notes: string | null }): Promise<string>;
  createApproval(req: ApprovalRequest): Promise<{ approvalId: string; taskId: string }>;
  recordAutoTask(args: { orgId: string; employeeId: string; conversationId: string; contactId: string; tool: string; input: unknown; output: unknown; ok: boolean; error?: string }): Promise<void>;
}

export interface ToolExecutionContext {
  repo: AiRepository;
  ctx: ConversationContext;
  employeeId: string;
  policy: ToolPolicy;
}

export interface ToolOutcome {
  /** Texto devolvido ao modelo (dado, não instrução). */
  result: string;
  isError: boolean;
  /** Efeitos colaterais relevantes para o orquestrador. */
  handoff?: string;
  approvalId?: string;
}
