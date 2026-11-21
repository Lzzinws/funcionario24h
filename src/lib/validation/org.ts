import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();

export const SEGMENTS = [
  ["saude", "Saúde e bem-estar"], ["beleza", "Beleza e estética"], ["varejo", "Loja e varejo"],
  ["alimentacao", "Alimentação"], ["servicos", "Serviços profissionais"], ["educacao", "Educação"],
  ["imobiliario", "Imobiliário"], ["automotivo", "Automotivo"], ["outro", "Outro"],
] as const;

export const createOrgSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa").max(120),
  segment: z.enum(SEGMENTS.map(([v]) => v) as [string, ...string[]], { message: "Escolha o segmento" }),
  plan: z.enum(["starter", "profissional", "business"]).default("starter"),
});

export const businessInfoSchema = z.object({
  description: optionalText(2000),
  address: optionalText(300),
  business_hours: optionalText(500),
  phone: optionalText(30),
  website: z.string().trim().max(200).refine((v) => v === "" || /^https?:\/\/\S+\.\S+/.test(v), "Use um endereço começando com https://")
    .transform((v) => (v === "" ? null : v)).optional(),
});
