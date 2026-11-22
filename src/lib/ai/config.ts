/**
 * Configuração do núcleo de IA. Valores ajustáveis por variável de ambiente
 * para controlar custo/qualidade sem mudar código.
 */
export const AI_CONFIG = {
  /** Modelo padrão. Pode ser trocado via AI_MODEL (ex.: claude-sonnet-5-5, claude-haiku-5-5). */
  model: process.env.AI_MODEL?.trim() || "claude-opus-5-5",
  /** Esforço de raciocínio: conversas de atendimento costumam ir bem em "low". */
  effort: (process.env.AI_EFFORT?.trim() || "low") as "low" | "medium" | "high",
  /** Teto de tokens por resposta (inclui o raciocínio interno do modelo). */
  maxOutputTokens: 4096,
  /** Máximo de chamadas de ferramenta encadeadas num único turno. */
  maxToolSteps: 6,
  /** Histórico enviado ao modelo: últimas N mensagens e no máximo X caracteres. */
  historyMessages: 20,
  historyChars: 12_000,
  /** Base de conhecimento embutida no prompt (acima disso, só via busca). */
  knowledgeInlineChars: 15_000,
  /** Tamanho máximo aceito de uma mensagem de cliente. */
  maxInboundChars: 4_000,
} as const;

/** Preço por milhão de tokens (USD), para estimar custo. Fonte: tabela pública da Anthropic. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Custo estimado em micro-dólares (inteiro). Escrita em cache custa 1,25x a entrada. */
export function estimateCostMicros(model: string, u: UsageLike): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const usd =
    (u.input_tokens * p.input + write * p.input * 1.25 + read * p.cacheRead + u.output_tokens * p.output) / 1_000_000;
  return Math.round(usd * 1_000_000);
}

export function totalInputTokens(u: UsageLike): number {
  return u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
}
