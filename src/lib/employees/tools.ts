import type { ToolPolicy } from "@/lib/types";

/**
 * Catálogo de ferramentas disponíveis para os funcionários digitais.
 * "sensitive" = sempre exige aprovação humana, independentemente da
 * configuração (descontos, pagamentos, confirmações e contato ativo).
 */
export const TOOL_CATALOG = {
  search_knowledge:     { label: "Consultar base de conhecimento", description: "Busca produtos, serviços, preços e políticas cadastrados.", sensitive: false },
  update_contact:       { label: "Atualizar dados do cliente", description: "Registra nome e e-mail informados pelo cliente.", sensitive: false },
  create_lead:          { label: "Registrar oportunidade", description: "Cria um lead no CRM quando há interesse comercial.", sensitive: false },
  update_lead_stage:    { label: "Atualizar etapa do lead", description: "Move o lead entre novo, qualificado, proposta e negociação.", sensitive: false },
  register_negotiation: { label: "Registrar negociação", description: "Anota o que foi conversado e o valor estimado no CRM.", sensitive: false },
  check_availability:   { label: "Consultar agenda", description: "Verifica horários já ocupados antes de sugerir um horário.", sensitive: false },
  request_appointment:  { label: "Solicitar agendamento", description: "Registra o pedido de horário para confirmação da equipe.", sensitive: true },
  schedule_follow_up:   { label: "Agendar acompanhamento", description: "Programa uma nova mensagem ativa ao cliente.", sensitive: true },
  request_discount:     { label: "Pedir condição especial", description: "Solicita desconto ou condição fora da tabela.", sensitive: true },
  transfer_to_human:    { label: "Transferir para humano", description: "Pausa a IA e avisa a equipe para assumir a conversa.", sensitive: false },
} as const;

export type ToolName = keyof typeof TOOL_CATALOG;
export const TOOL_NAMES = Object.keys(TOOL_CATALOG) as ToolName[];

export const isToolName = (t: string): t is ToolName => t in TOOL_CATALOG;

/** Política efetiva: ferramentas sensíveis nunca rodam em modo automático. */
export function effectivePolicy(tool: ToolName, configured: ToolPolicy | undefined): ToolPolicy {
  const policy = configured ?? "denied";
  if (policy === "denied") return "denied";
  return TOOL_CATALOG[tool].sensitive ? "approval" : policy;
}
