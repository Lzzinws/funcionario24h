import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { TOOL_CATALOG, effectivePolicy, isToolName, type ToolName } from "@/lib/employees/tools";
import type { ToolPolicy } from "@/lib/types";

/**
 * Definições das ferramentas enviadas ao modelo (JSON Schema estrito) e os
 * schemas zod que REVALIDAM cada chamada no servidor. Nenhuma ferramenta
 * recebe IDs de outras entidades: tudo opera sobre a conversa/cliente atual.
 */
type JsonSchema = Record<string, unknown>;
const str = (description: string, maxLength = 500): JsonSchema => ({ type: "string", description, maxLength });
const nullable = (s: JsonSchema): JsonSchema => ({ ...s, type: [s.type as string, "null"] });

function objectSchema(properties: Record<string, JsonSchema>): Anthropic.Beta.BetaTool.InputSchema {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const LEAD_STAGES = ["novo", "qualificado", "proposta", "negociacao"] as const;

export const TOOL_DEFS: Record<ToolName, { description: string; schema: Anthropic.Beta.BetaTool.InputSchema; zod: z.ZodTypeAny }> = {
  search_knowledge: {
    description: "Busca na base de conhecimento da empresa (produtos, serviços, preços, políticas, perguntas frequentes). Use antes de afirmar qualquer preço, prazo ou política que não esteja no contexto.",
    schema: objectSchema({ query: str("Palavras-chave da busca, em português", 200) }),
    zod: z.object({ query: z.string().trim().min(2).max(200) }),
  },
  update_contact: {
    description: "Registra o nome e/ou e-mail que o próprio cliente informou na conversa. Não invente dados.",
    schema: objectSchema({ name: nullable(str("Nome informado pelo cliente", 120)), email: nullable(str("E-mail informado pelo cliente", 200)) }),
    zod: z.object({ name: z.string().trim().min(2).max(120).nullable(), email: z.string().trim().email().max(200).nullable() }),
  },
  create_lead: {
    description: "Registra no CRM uma oportunidade quando o cliente demonstra interesse comercial concreto. Se já existir uma oportunidade aberta, ela é atualizada.",
    schema: objectSchema({
      interest: str("O que o cliente quer, em uma frase", 300),
      estimated_value_brl: nullable({ type: "number", description: "Valor estimado em reais, somente se baseado em preço cadastrado" }),
    }),
    zod: z.object({ interest: z.string().trim().min(3).max(300), estimated_value_brl: z.number().min(0).max(10_000_000).nullable() }),
  },
  update_lead_stage: {
    description: "Atualiza a etapa da oportunidade do cliente atual. Nunca marque venda como concluída: isso só pode ser feito por um humano.",
    schema: objectSchema({ stage: { type: "string", enum: [...LEAD_STAGES] }, reason: str("Motivo da mudança", 300) }),
    zod: z.object({ stage: z.enum(LEAD_STAGES), reason: z.string().trim().min(3).max(300) }),
  },
  register_negotiation: {
    description: "Anota no CRM o que foi negociado com o cliente (condições discutidas, objeções, próximos passos).",
    schema: objectSchema({ notes: str("Resumo objetivo da negociação", 1000), estimated_value_brl: nullable({ type: "number", description: "Valor estimado em reais" }) }),
    zod: z.object({ notes: z.string().trim().min(5).max(1000), estimated_value_brl: z.number().min(0).max(10_000_000).nullable() }),
  },
  check_availability: {
    description: "Consulta horários já ocupados na agenda entre duas datas (formato AAAA-MM-DD) para sugerir horários livres dentro do horário de funcionamento.",
    schema: objectSchema({ from_date: str("Data inicial AAAA-MM-DD", 10), to_date: str("Data final AAAA-MM-DD (até 14 dias depois)", 10) }),
    zod: z.object({ from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  },
  request_appointment: {
    description: "Registra um pedido de agendamento para aprovação da equipe. O horário só fica confirmado depois que um humano aprovar.",
    schema: objectSchema({
      service: str("Serviço solicitado", 200),
      starts_at: str("Data e hora desejadas no formato AAAA-MM-DDTHH:MM (horário local da empresa)", 16),
      notes: nullable(str("Observações do cliente", 500)),
      justification: str("Por que este agendamento deve ser aprovado", 300),
    }),
    zod: z.object({
      service: z.string().trim().min(2).max(200),
      starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      notes: z.string().trim().max(500).nullable(),
      justification: z.string().trim().min(3).max(300),
    }),
  },
  schedule_follow_up: {
    description: "Pede autorização para enviar uma mensagem de acompanhamento ao cliente numa data futura.",
    schema: objectSchema({ when: str("Data e hora AAAA-MM-DDTHH:MM", 16), message: str("Mensagem proposta", 600), justification: str("Motivo do acompanhamento", 300) }),
    zod: z.object({ when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), message: z.string().trim().min(5).max(600), justification: z.string().trim().min(3).max(300) }),
  },
  request_discount: {
    description: "Pede à equipe autorização para oferecer desconto ou condição especial. Nunca prometa o desconto antes da aprovação.",
    schema: objectSchema({ offer: str("Condição pretendida (ex.: 10% à vista no serviço X)", 300), justification: str("Por que a condição faz sentido", 300) }),
    zod: z.object({ offer: z.string().trim().min(3).max(300), justification: z.string().trim().min(3).max(300) }),
  },
  transfer_to_human: {
    description: "Transfere a conversa para um atendente humano. Use quando não souber responder, quando o cliente pedir, em reclamações, ou em assuntos financeiros, jurídicos ou sensíveis.",
    schema: objectSchema({ reason: str("Motivo da transferência", 300) }),
    zod: z.object({ reason: z.string().trim().min(3).max(300) }),
  },
};

/** Ferramentas que o funcionário pode usar, com a política efetiva de cada uma. */
export function allowedTools(tools: string[], permissions: Record<string, ToolPolicy>): Map<ToolName, ToolPolicy> {
  const out = new Map<ToolName, ToolPolicy>();
  for (const t of tools) {
    if (!isToolName(t)) continue;
    const policy = effectivePolicy(t, permissions[t]);
    if (policy !== "denied") out.set(t, policy);
  }
  return out;
}

/** Converte em definições da API, em ordem determinística (estável para cache). */
export function toApiTools(allowed: Map<ToolName, ToolPolicy>): Anthropic.Beta.BetaTool[] {
  return [...allowed.keys()].sort().map((name) => ({
    name,
    description:
      TOOL_DEFS[name].description +
      (allowed.get(name) === "approval" ? " Esta ação fica pendente até aprovação humana." : ""),
    input_schema: TOOL_DEFS[name].schema,
    strict: true,
  }));
}

export { TOOL_CATALOG };
