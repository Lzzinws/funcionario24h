import "server-only";

/**
 * Cliente mínimo da API de Assinaturas do Mercado Pago (REST oficial).
 * Endpoints: POST/GET/PUT /preapproval, GET /authorized_payments/{id}.
 */
const API = "https://api.mercadopago.com";

export type PreapprovalStatus = "pending" | "authorized" | "paused" | "canceled" | "cancelled";

export interface Preapproval {
  id: string;
  status: PreapprovalStatus;
  init_point?: string;
  external_reference?: string | number;
  next_payment_date?: string;
  payer_id?: number;
  reason?: string;
  auto_recurring?: { transaction_amount?: number | string; currency_id?: string };
}

export interface AuthorizedPayment {
  id: number | string;
  preapproval_id: string;
  status: "scheduled" | "processed" | "recycling" | "canceled";
  transaction_amount?: number | string;
  debit_date?: string;
  last_modified?: string;
  payment?: { id?: number | string; status?: string; status_detail?: string } | null;
}

export class MercadoPagoError extends Error {
  constructor(public status: number, message: string) { super(message); }
  get retryable() { return this.status === 429 || this.status >= 500; }
}

export class MercadoPagoClient {
  constructor(private accessToken: string, private fetchImpl: typeof fetch = fetch) {}

  private async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try { const j = JSON.parse(text); msg = j.message ?? j.error ?? msg; } catch { /* corpo não-JSON */ }
      throw new MercadoPagoError(res.status, `Mercado Pago ${res.status}: ${msg}`);
    }
    return JSON.parse(text) as T;
  }

  createPreapproval(input: {
    reason: string; externalReference: string; payerEmail: string; amountBrl: number; backUrl: string; idempotencyKey: string;
  }) {
    return this.request<Preapproval>("POST", "/preapproval", {
      reason: input.reason,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: input.amountBrl, currency_id: "BRL" },
      back_url: input.backUrl,
      status: "pending",
    }, input.idempotencyKey);
  }

  getPreapproval(id: string) {
    return this.request<Preapproval>("GET", `/preapproval/${encodeURIComponent(id)}`);
  }

  cancelPreapproval(id: string) {
    return this.request<Preapproval>("PUT", `/preapproval/${encodeURIComponent(id)}`, { status: "canceled" });
  }

  getAuthorizedPayment(id: string) {
    return this.request<AuthorizedPayment>("GET", `/authorized_payments/${encodeURIComponent(id)}`);
  }
}
