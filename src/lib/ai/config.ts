/**
 * Configuração do núcleo de IA. Valores ajustáveis por variável de ambiente
 * para controlar custo/qualidade sem mudar código.
 */
export const AI_CONFIG = {
  /** Modelo Gemini. Padrão: Flash estável. Pode ser trocado via AI_MODEL. */
  model: process.env.AI_MODEL?.trim() || "gemini-3.6-flash",
  /** Teto de tokens por resposta. */
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

export interface UsageLike {
  input: number;
  output: number;
}

/**
 * Custo estimado em micro-dólares. Os preços NÃO estão fixados no código:
 * configure GEMINI_PRICE_INPUT_PER_M e GEMINI_PRICE_OUTPUT_PER_M (USD por
 * milhão de tokens) no Vercel. Sem eles, o custo fica 0 e só os tokens contam.
 */
export function estimateCostMicros(u: UsageLike): number {
  const inPrice = Number(process.env.GEMINI_PRICE_INPUT_PER_M ?? 0) || 0;
  const outPrice = Number(process.env.GEMINI_PRICE_OUTPUT_PER_M ?? 0) || 0;
  const usd = (u.input * inPrice + u.output * outPrice) / 1_000_000;
  return Math.round(usd * 1_000_000);
}
