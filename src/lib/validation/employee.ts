import { z } from "zod";
import { TOOL_NAMES, effectivePolicy, type ToolName } from "@/lib/employees/tools";
import type { ToolPolicy } from "@/lib/types";

export const ROLE_TYPES = [
  ["atendente", "Atendente"], ["vendedor", "Vendedor"], ["agendador", "Agendador"],
  ["administrativo", "Administrativo"], ["pos_venda", "Pós-venda"], ["financeiro", "Financeiro"],
  ["marketing", "Marketing"], ["personalizado", "Personalizado"],
] as const;

export const EMPLOYEE_COLORS = ["#65D69B", "#9BD3F0", "#F2C66D", "#E8A3C4", "#B9A6F2", "#F0A07A"] as const;

const lines = (max: number) =>
  z.string().optional().transform((v) => (v ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, max));

export const employeeSchema = z.object({
  name: z.string().trim().min(2, "Informe um nome").max(60, "Máximo de 60 caracteres"),
  title: z.string().trim().min(2, "Informe o cargo").max(80),
  role_type: z.enum(ROLE_TYPES.map(([v]) => v) as [string, ...string[]]),
  color: z.enum(EMPLOYEE_COLORS),
  personality: z.string().trim().max(2000, "Máximo de 2.000 caracteres").default(""),
  goals: lines(8),
  instructions: z.string().trim().min(20, "Escreva instruções com pelo menos 20 caracteres").max(8000, "Máximo de 8.000 caracteres"),
});

/**
 * Lê as políticas de ferramentas do formulário ("tool:<nome>" = auto|approval|denied).
 * Ferramentas sensíveis são forçadas para "approval" (nunca automáticas).
 */
export function parseToolPolicies(form: FormData): { tools: ToolName[]; permissions: Record<string, ToolPolicy> } {
  const permissions: Record<string, ToolPolicy> = {};
  for (const tool of TOOL_NAMES) {
    const raw = form.get(`tool:${tool}`);
    const configured: ToolPolicy = raw === "auto" || raw === "approval" ? raw : "denied";
    const policy = effectivePolicy(tool, configured);
    if (policy !== "denied") permissions[tool] = policy;
  }
  return { tools: Object.keys(permissions) as ToolName[], permissions };
}
