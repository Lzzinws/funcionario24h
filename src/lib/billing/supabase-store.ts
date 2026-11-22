import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingStore } from "./service";

/** BillingStore sobre as funções SQL (somente service_role). */
export function supabaseBillingStore(db: SupabaseClient): BillingStore {
  return {
    async attachCheckout(checkoutId, providerSubscriptionId) {
      const { error } = await db.from("billing_checkouts")
        .update({ provider_subscription_id: providerSubscriptionId })
        .eq("id", checkoutId).is("provider_subscription_id", null);
      if (error) throw new Error(`attachCheckout: ${error.message}`);
    },
    async applySubscription(id, status, next) {
      const { data, error } = await db.rpc("billing_apply_subscription", {
        p_provider_subscription_id: id, p_provider_status: status, p_next_payment_date: next,
      });
      if (error) throw new Error(`billing_apply_subscription: ${error.message}`);
      return (data as string | null) ?? null;
    },
    async recordPayment(a) {
      const { error } = await db.rpc("billing_record_payment", {
        p_provider_subscription_id: a.providerSubscriptionId, p_invoice_id: a.invoiceId, p_payment_id: a.paymentId,
        p_amount_cents: a.amountCents, p_payment_status: a.status, p_status_detail: a.statusDetail, p_paid_at: a.paidAt,
      });
      if (error) throw new Error(`billing_record_payment: ${error.message}`);
    },
  };
}
