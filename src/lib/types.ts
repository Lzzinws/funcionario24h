/** Tipos de linha das tabelas principais (espelham supabase/migrations). */
export type MemberRole = "owner" | "admin" | "agent" | "viewer";

export type EmployeeRoleType =
  | "atendente" | "vendedor" | "agendador" | "administrativo"
  | "pos_venda" | "financeiro" | "marketing" | "personalizado";

export type ToolPolicy = "auto" | "approval" | "denied";

export interface Organization {
  id: string;
  name: string;
  segment: string | null;
  description: string | null;
  address: string | null;
  business_hours: string | null;
  phone: string | null;
  website: string | null;
  timezone: string;
  status: "active" | "suspended";
  suspended_reason: string | null;
  onboarding_step: number;
  onboarding_completed_at: string | null;
  created_at: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  max_employees: number;
  max_whatsapp_numbers: number;
  monthly_ai_tokens: number;
  features: Record<string, boolean>;
  is_active: boolean;
  sort_order: number;
}

export interface Subscription {
  id: string;
  organization_id: string;
  plan_id: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "suspended";
  trial_ends_at: string | null;
  current_period_end: string;
  cancel_at: string | null;
  provider_subscription_id: string | null;
  provider_status: string | null;
  last_payment_at: string | null;
  last_payment_status: string | null;
}

export interface EmployeeTemplate {
  id: string;
  role_type: EmployeeRoleType;
  name: string;
  title: string;
  description: string;
  default_personality: string;
  default_instructions: string;
  default_goals: string[];
  default_tools: string[];
  default_permissions: Record<string, ToolPolicy>;
}

export interface Employee {
  id: string;
  organization_id: string;
  template_id: string | null;
  role_type: EmployeeRoleType;
  name: string;
  title: string;
  personality: string;
  goals: string[];
  tools: string[];
  permissions: Record<string, ToolPolicy>;
  is_active: boolean;
  is_default: boolean;
  color: string;
  created_at: string;
  updated_at: string;
}

export type KnowledgeCategory =
  | "produto" | "servico" | "preco" | "horario" | "endereco" | "faq" | "politica" | "documento" | "outro";

export interface KnowledgeItem {
  id: string;
  organization_id: string;
  category: KnowledgeCategory;
  title: string;
  content: string;
  price_cents: number | null;
  is_published: boolean;
  allowed_employee_ids: string[] | null;
  updated_at: string;
}

export interface DashboardStats {
  employees_active: number;
  employees_total: number;
  conversations: number;
  conversations_open: number;
  waiting_human: number;
  leads: number;
  tasks_done: number;
  approvals_pending: number;
  ai_input_tokens: number;
  ai_output_tokens: number;
  avg_first_response_seconds: number | null;
  hourly: number[];
  daily: { day: string; conversations: number; messages: number }[];
}

export interface AuditLog {
  id: number;
  actor_type: "user" | "employee" | "system" | "platform_admin";
  action: string;
  entity_type: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
