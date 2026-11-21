import { z } from "zod";
import { parseBRLToCents } from "@/lib/utils";

export const KNOWLEDGE_CATEGORIES = [
  ["produto", "Produto"], ["servico", "Serviço"], ["preco", "Preço / tabela"], ["horario", "Horário"],
  ["endereco", "Endereço / localização"], ["faq", "Pergunta frequente"], ["politica", "Política comercial"],
  ["documento", "Documento"], ["outro", "Outro"],
] as const;

export const knowledgeSchema = z.object({
  category: z.enum(KNOWLEDGE_CATEGORIES.map(([v]) => v) as [string, ...string[]], { message: "Escolha a categoria" }),
  title: z.string().trim().min(1, "Informe um título").max(200),
  content: z.string().trim().max(20000, "Texto muito longo (máx. 20 mil caracteres)").default(""),
  price: z.string().optional().transform((v, ctx) => {
    if (!v || v.trim() === "") return null;
    const cents = parseBRLToCents(v);
    if (cents == null) { ctx.addIssue({ code: "custom", message: "Use um valor como 149,90" }); return z.NEVER; }
    return cents;
  }),
  is_published: z.preprocess((v) => v === "on" || v === true, z.boolean()).default(true),
});
