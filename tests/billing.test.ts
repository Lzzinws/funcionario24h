import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyMercadoPagoSignature } from "@/lib/billing/signature";
import { externalReference, parseExternalReference, syncAuthorizedPayment, syncPreapproval, type BillingStore } from "@/lib/billing/service";
import { MercadoPagoClient } from "@/lib/billing/mercadopago";
import { effectiveState, canOperate } from "@/lib/billing/state";

const SECRET = "segredo-de-teste-123456";
const sign = (manifest: string) => createHmac("sha256", SECRET).update(manifest).digest("hex");
const NOW = 1_795_000_000_000;

describe("assinatura do webhook (x-signature)", () => {
  const ts = String(NOW / 1000);
  it("aceita assinatura válida", () => {
    const v1 = sign(`id:123;request-id:req-1;ts:${ts};`);
    expect(verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "123", secret: SECRET, nowMs: NOW }).valid).toBe(true);
  });
  it("usa data.id em minúsculas quando alfanumérico", () => {
    const v1 = sign(`id:abc123;request-id:req-1;ts:${ts};`);
    expect(verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "ABC123", secret: SECRET, nowMs: NOW }).valid).toBe(true);
  });
  it("omite do manifesto os valores ausentes", () => {
    const v1 = sign(`id:123;ts:${ts};`);
    expect(verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: null, dataId: "123", secret: SECRET, nowMs: NOW }).valid).toBe(true);
  });
  it("rejeita assinatura forjada, ausente, malformada ou antiga", () => {
    const v1 = sign(`id:123;request-id:req-1;ts:${ts};`);
    expect(verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "999", secret: SECRET, nowMs: NOW }).valid).toBe(false);
    expect(verifyMercadoPagoSignature({ xSignature: null, xRequestId: "req-1", dataId: "123", secret: SECRET, nowMs: NOW }).valid).toBe(false);
    expect(verifyMercadoPagoSignature({ xSignature: "lixo", xRequestId: "req-1", dataId: "123", secret: SECRET, nowMs: NOW }).valid).toBe(false);
    expect(verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "123", secret: SECRET, nowMs: NOW + 3_600_000 }).reason).toBe("notificação expirada");
    expect(verifyMercadoPagoSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "123", secret: "", nowMs: NOW }).valid).toBe(false);
  });
});

// ------------------------------------------------------------- fakes
function fakeFetch(routes: Record<string, unknown>) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${url.replace("https://api.mercadopago.com", "")}`;
    if (!(key in routes)) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

class FakeStore implements BillingStore {
  attached: [string, string][] = [];
  applied: [string, string, string | null][] = [];
  payments: Parameters<BillingStore["recordPayment"]>[0][] = [];
  constructor(private replaced: string | null = null) {}
  async attachCheckout(c: string, p: string) { this.attached.push([c, p]); }
  async applySubscription(id: string, status: string, next: string | null) { this.applied.push([id, status, next]); return this.replaced; }
  async recordPayment(a: Parameters<BillingStore["recordPayment"]>[0]) { this.payments.push(a); }
}

const CHECKOUT = "3f1b2c4d-1111-4222-8333-944455556666";

describe("sincronização com o Mercado Pago", () => {
  it("aplica o estado consultado na API (não o corpo do webhook) e vincula o checkout", async () => {
    const { fn } = fakeFetch({ "GET /preapproval/pre-1": { id: "pre-1", status: "authorized", external_reference: externalReference(CHECKOUT), next_payment_date: "2026-12-22T00:00:00Z" } });
    const store = new FakeStore();
    await syncPreapproval("pre-1", { mp: new MercadoPagoClient("TEST-token", fn), store });
    expect(store.attached).toEqual([[CHECKOUT, "pre-1"]]);
    expect(store.applied).toEqual([["pre-1", "authorized", "2026-12-22T00:00:00Z"]]);
  });

  it("na troca de plano, cancela a assinatura antiga no gateway", async () => {
    const { fn, calls } = fakeFetch({
      "GET /preapproval/pre-2": { id: "pre-2", status: "authorized", external_reference: externalReference(CHECKOUT) },
      "PUT /preapproval/pre-1": { id: "pre-1", status: "canceled" },
    });
    await syncPreapproval("pre-2", { mp: new MercadoPagoClient("t", fn), store: new FakeStore("pre-1") });
    expect(calls.find((c) => c.method === "PUT")).toMatchObject({ url: expect.stringContaining("/preapproval/pre-1"), body: { status: "canceled" } });
  });

  it("registra a cobrança recorrente com valor em centavos", async () => {
    const { fn } = fakeFetch({
      "GET /authorized_payments/777": { id: 777, preapproval_id: "pre-1", status: "processed", transaction_amount: "119.90", last_modified: "2026-11-22T10:00:00Z", payment: { id: 999, status: "approved", status_detail: "accredited" } },
    });
    const store = new FakeStore();
    await syncAuthorizedPayment("777", { mp: new MercadoPagoClient("t", fn), store });
    expect(store.payments[0]).toEqual({ providerSubscriptionId: "pre-1", invoiceId: "777", paymentId: "999", amountCents: 11990, status: "approved", statusDetail: "accredited", paidAt: "2026-11-22T10:00:00Z" });
  });

  it("referência externa só aceita o formato do sistema", () => {
    expect(parseExternalReference(externalReference(CHECKOUT))).toBe(CHECKOUT);
    expect(parseExternalReference("outra-coisa")).toBeNull();
    expect(parseExternalReference(123)).toBeNull();
  });
});

describe("situação da assinatura", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  it("teste vencido pausa os funcionários", () => {
    const s = effectiveState({ status: "trialing", trial_ends_at: "2026-11-20T00:00:00Z", current_period_end: "2026-12-01T00:00:00Z" }, now);
    expect(s).toBe("trial_expired");
    expect(canOperate(s)).toBe(false);
  });
  it("cancelada continua operando até o fim do período pago", () => {
    expect(effectiveState({ status: "active", trial_ends_at: null, current_period_end: "2026-12-01T00:00:00Z", cancel_at: "2026-12-01T00:00:00Z" }, now)).toBe("canceling");
    expect(effectiveState({ status: "active", trial_ends_at: null, current_period_end: "2026-11-01T00:00:00Z", cancel_at: "2026-11-01T00:00:00Z" }, now)).toBe("inactive");
  });
});

// ------------------------------------------------- endpoint do webhook
const rpc = vi.fn();
const tableOps: { table: string; op: string; payload?: unknown }[] = [];
vi.mock("@/lib/supabase/admin", () => {
  const chain = (table: string) => {
    const api: Record<string, unknown> = {};
    const self = new Proxy(api, {
      get(_t, prop: string) {
        if (prop === "then") return (r: (v: unknown) => void) => r({ data: null, error: null });
        return (...args: unknown[]) => {
          if (prop === "upsert" || prop === "update" || prop === "insert") tableOps.push({ table, op: prop, payload: args[0] });
          return self;
        };
      },
    });
    return self;
  };
  return { createAdminClient: () => ({ from: chain, rpc: (name: string, args: unknown) => { rpc(name, args); return Promise.resolve({ data: null, error: null }); } }) };
});

describe("POST /api/webhooks/mercadopago", () => {
  beforeEach(() => {
    rpc.mockClear();
    tableOps.length = 0;
    process.env.MP_ACCESS_TOKEN = "TEST-1234567890";
    process.env.MP_WEBHOOK_SECRET = SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-tests-0000";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key-for-tests-0000";
  });

  async function post(dataId: string, type: string, opts: { tamper?: boolean } = {}) {
    const { POST } = await import("@/app/api/webhooks/mercadopago/route");
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = sign(`id:${dataId};request-id:req-9;ts:${ts};`);
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(`https://app.test/api/webhooks/mercadopago?data.id=${dataId}&type=${type}`, {
      method: "POST",
      headers: { "x-signature": `ts=${ts},v1=${opts.tamper ? "0".repeat(64) : v1}`, "x-request-id": "req-9", "content-type": "application/json" },
      body: JSON.stringify({ action: "updated", type, data: { id: dataId }, live_mode: false }),
    });
    return POST(req);
  }

  it("rejeita notificação sem assinatura válida e não toca no banco", async () => {
    const res = await post("pre-1", "subscription_preapproval", { tamper: true });
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("assinatura autorizada: consulta o Mercado Pago e atualiza o plano", async () => {
    const { fn } = fakeFetch({ "GET /preapproval/pre-1": { id: "pre-1", status: "authorized", external_reference: externalReference(CHECKOUT) } });
    vi.stubGlobal("fetch", fn);
    const res = await post("pre-1", "subscription_preapproval");
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("billing_apply_subscription", expect.objectContaining({ p_provider_subscription_id: "pre-1", p_provider_status: "authorized" }));
    expect(tableOps.some((o) => o.table === "webhook_events" && o.op === "upsert")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("cobrança recorrente aprovada é registrada", async () => {
    const { fn } = fakeFetch({ "GET /authorized_payments/555": { id: 555, preapproval_id: "pre-1", status: "processed", transaction_amount: 59.9, payment: { id: 1, status: "approved", status_detail: "accredited" } } });
    vi.stubGlobal("fetch", fn);
    const res = await post("555", "subscription_authorized_payment");
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("billing_record_payment", expect.objectContaining({ p_payment_status: "approved", p_amount_cents: 5990 }));
    vi.unstubAllGlobals();
  });

  it("Mercado Pago fora do ar: responde 500 para receber nova tentativa", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const res = await post("pre-1", "subscription_preapproval");
    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("ignora tópicos que não são de assinatura", async () => {
    const res = await post("123", "payment");
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });
});
