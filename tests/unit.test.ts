import { describe, expect, it } from "vitest";
import { effectivePolicy } from "@/lib/employees/tools";
import { parseToolPolicies } from "@/lib/validation/employee";
import { parseBRLToCents } from "@/lib/utils";
import { safeNext, signUpSchema } from "@/lib/validation/auth";
import { knowledgeSchema } from "@/lib/validation/knowledge";

describe("políticas de ferramentas", () => {
  it("ferramentas sensíveis nunca rodam sozinhas", () => {
    expect(effectivePolicy("request_discount", "auto")).toBe("approval");
    expect(effectivePolicy("request_appointment", "auto")).toBe("approval");
    expect(effectivePolicy("schedule_follow_up", "auto")).toBe("approval");
  });
  it("respeita 'denied' e aceita 'auto' em ferramentas comuns", () => {
    expect(effectivePolicy("request_discount", "denied")).toBe("denied");
    expect(effectivePolicy("search_knowledge", "auto")).toBe("auto");
    expect(effectivePolicy("search_knowledge", undefined)).toBe("denied");
  });
  it("formulário forjado não libera ferramenta sensível nem ferramenta inexistente", () => {
    const f = new FormData();
    f.set("tool:request_discount", "auto");
    f.set("tool:search_knowledge", "auto");
    f.set("tool:delete_database", "auto");
    f.set("tool:transfer_to_human", "qualquer");
    const { tools, permissions } = parseToolPolicies(f);
    expect(permissions).toEqual({ request_discount: "approval", search_knowledge: "auto" });
    expect(tools).not.toContain("delete_database");
  });
});

describe("validações", () => {
  it("converte preços em reais para centavos", () => {
    expect(parseBRLToCents("1.234,56")).toBe(123456);
    expect(parseBRLToCents("R$ 89,9")).toBe(8990);
    expect(parseBRLToCents("150")).toBe(15000);
    expect(parseBRLToCents("")).toBeNull();
    expect(parseBRLToCents("abc")).toBeNull();
  });
  it("bloqueia redirecionamento aberto após login", () => {
    expect(safeNext("/painel")).toBe("/painel");
    expect(safeNext("//evil.com")).toBe("/painel");
    expect(safeNext("https://evil.com")).toBe("/painel");
    expect(safeNext(null)).toBe("/painel");
  });
  it("exige senha forte e aceite dos termos", () => {
    const base = { full_name: "Ana", email: "a@b.com", password: "abcdefg1", accept_terms: "on" };
    expect(signUpSchema.safeParse(base).success).toBe(true);
    expect(signUpSchema.safeParse({ ...base, password: "abcdefgh" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, accept_terms: undefined }).success).toBe(false);
  });
  it("item da base valida preço", () => {
    expect(knowledgeSchema.safeParse({ category: "servico", title: "Limpeza", price: "149,90" }).data?.price).toBe(14990);
    expect(knowledgeSchema.safeParse({ category: "servico", title: "Limpeza", price: "x" }).success).toBe(false);
    expect(knowledgeSchema.safeParse({ category: "hack", title: "Limpeza" }).success).toBe(false);
  });
});
