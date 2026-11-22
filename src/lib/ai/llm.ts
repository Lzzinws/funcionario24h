import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Abstração mínima do modelo — permite testar o orquestrador sem chamadas reais. */
export interface LlmClient {
  createMessage(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
}

let client: Anthropic | null = null;

/**
 * Cliente Anthropic real. Usa ANTHROPIC_API_KEY do servidor.
 * Fallback no servidor: se o modelo recusar por política, a própria API
 * re-executa o pedido num modelo alternativo adequado ("default").
 */
export function anthropicLlm(): LlmClient {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LlmNotConfiguredError();
  }
  client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 });
  return {
    createMessage: (params) =>
      client!.beta.messages.create({
        ...params,
        betas: [...(params.betas ?? []), "server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }),
  };
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY não configurada no servidor.");
  }
}
