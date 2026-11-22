import "server-only";
import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import { AI_CONFIG } from "./config";

/**
 * Camada do modelo (Google Gemini). O orquestrador só enxerga este contrato,
 * então trocar de modelo ou de provedor não mexe na lógica de negócio.
 */
export type LlmContent = Content;

export interface LlmToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmTurn {
  /** Conteúdo do modelo exatamente como veio da API (preserva assinaturas de raciocínio). */
  modelContent: LlmContent;
  text: string;
  toolCalls: LlmToolCall[];
  /** true quando os filtros de segurança bloquearam a resposta. */
  blocked: boolean;
  usage: { input: number; output: number };
}

export interface LlmRequest {
  system: string;
  contents: LlmContent[];
  tools: FunctionDeclaration[];
  maxOutputTokens: number;
}

export interface LlmClient {
  generate(req: LlmRequest): Promise<LlmTurn>;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY não configurada no servidor.");
  }
}

let client: GoogleGenAI | null = null;

/** Cliente Gemini real. Usa GEMINI_API_KEY (somente no servidor). */
export function geminiLlm(): LlmClient {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new LlmNotConfiguredError();
  client ??= new GoogleGenAI({ apiKey });

  return {
    async generate(req) {
      const res = await client!.models.generateContent({
        model: AI_CONFIG.model,
        contents: req.contents,
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxOutputTokens,
          ...(req.tools.length ? { tools: [{ functionDeclarations: req.tools }] } : {}),
        },
      });

      const candidate = res.candidates?.[0];
      const modelContent: LlmContent = candidate?.content ?? { role: "model", parts: [] };
      const toolCalls: LlmToolCall[] = (res.functionCalls ?? []).map((c) => ({
        id: c.id,
        name: c.name ?? "",
        args: (c.args ?? {}) as Record<string, unknown>,
      }));
      const text = (res.text ?? "").trim();
      const finish = candidate?.finishReason === undefined ? undefined : String(candidate.finishReason);
      // Bloqueado: sem resposta útil e com motivo diferente de conclusão normal.
      const blocked =
        !!res.promptFeedback?.blockReason ||
        !candidate ||
        (!text && toolCalls.length === 0 && finish !== undefined && finish !== "STOP" && finish !== "MAX_TOKENS");

      return {
        modelContent,
        text,
        toolCalls,
        blocked,
        usage: {
          input: res.usageMetadata?.promptTokenCount ?? 0,
          output: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0),
        },
      };
    },
  };
}
