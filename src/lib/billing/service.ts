import type { MercadoPagoClient, AuthorizedPayment } from "./mercadopago";

/** Operações de banco usadas pela cobrança (implementadas via RPC com service_role). */
export interface BillingStore {
  /** Vincula a assinatura do gateway ao checkout de origem (idempotente). */
  attachCheckout(checkoutId: string, providerSubscriptionId: string): Promise<void>;
  applySubscription(providerSubscriptionId: string, status: string, nextPaymentDate: string | null): Promise<string | null>;
  recordPayment(args: { providerSubscriptionId: string; invoiceId: string; paymentId: string | null; amountCents: number; status: string; statusDetail: string | null; paidAt: string | null }): Promise<void>;
}

export const toCents = (v: number | string | undefined | null) => Math.round(Number(v ?? 0) * 100);

/**
 * Busca a assinatura no Mercado Pago e aplica o estado no banco.
 * Se uma assinatura nova substituiu a anterior (troca de plano), cancela a antiga
 * no gateway para o cliente não ser cobrado duas vezes.
 */
export async function syncPreapproval(id: string, deps: { mp: MercadoPagoClient; store: BillingStore }) {
  const pre = await deps.mp.getPreapproval(id);
  const checkoutId = parseExternalReference(pre.external_reference);
  if (checkoutId) await deps.store.attachCheckout(checkoutId, pre.id);
  const replaced = await deps.store.applySubscription(pre.id, pre.status, pre.next_payment_date ?? null);
  if (replaced) {
    try {
      await deps.mp.cancelPreapproval(replaced);
    } catch (e) {
      // Não falha o webhook: o cancelamento será refeito quando a antiga notificar.
      console.error("cancelar assinatura substituída:", e instanceof Error ? e.message : e);
    }
  }
  return pre;
}

/** Busca a fatura (cobrança recorrente) e registra o pagamento. */
export async function syncAuthorizedPayment(id: string, deps: { mp: MercadoPagoClient; store: BillingStore }) {
  const inv: AuthorizedPayment = await deps.mp.getAuthorizedPayment(id);
  const p = inv.payment ?? null;
  const status = p?.status ?? (inv.status === "canceled" ? "canceled" : "pending");
  await deps.store.recordPayment({
    providerSubscriptionId: inv.preapproval_id,
    invoiceId: String(inv.id),
    paymentId: p?.id != null ? String(p.id) : null,
    amountCents: toCents(inv.transaction_amount),
    status,
    statusDetail: p?.status_detail ?? null,
    paidAt: status === "approved" ? (inv.last_modified ?? inv.debit_date ?? null) : null,
  });
  return inv;
}

export type WebhookTopic = "subscription_preapproval" | "subscription_authorized_payment" | "ignored";

/** Identifica o tipo da notificação (corpo JSON ou parâmetros da URL). */
export function parseTopic(type: string | null | undefined): WebhookTopic {
  if (type === "subscription_preapproval") return "subscription_preapproval";
  if (type === "subscription_authorized_payment") return "subscription_authorized_payment";
  return "ignored";
}

/** Referência externa enviada ao gateway: "f24h:<uuid do checkout>". */
export const externalReference = (checkoutId: string) => `f24h:${checkoutId}`;

export function parseExternalReference(ref: unknown): string | null {
  const m = /^f24h:([0-9a-f-]{36})$/i.exec(String(ref ?? ""));
  return m ? m[1].toLowerCase() : null;
}
