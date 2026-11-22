"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError, requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingConfig } from "@/lib/billing/config";
import { MercadoPagoClient, MercadoPagoError } from "@/lib/billing/mercadopago";
import { externalReference, syncPreapproval } from "@/lib/billing/service";
import { supabaseBillingStore } from "@/lib/billing/supabase-store";
import type { ActionState } from "@/lib/action-result";

const checkoutSchema = z.object({
  plan_id: z.enum(["starter", "profissional", "business"]),
  payer_email: z.string().trim().email("Informe o e-mail da conta Mercado Pago que vai pagar"),
});

async function ownerCtx() {
  try { return { ctx: await requireOrg(["owner"]) }; }
  catch (e) { if (e instanceof AuthorizationError) return { error: "Somente o proprietário da empresa pode gerenciar a assinatura." }; throw e; }
}

/**
 * Inicia a contratação: grava o checkout, cria a assinatura no Mercado Pago
 * (status "pending") e redireciona o cliente para o checkout do gateway.
 * O valor vem SEMPRE da tabela de planos no servidor, nunca do navegador.
 */
export async function startCheckout(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx, error } = await ownerCtx();
  if (!ctx) return { ok: false, message: error };
  const cfg = billingConfig();
  if (!cfg.ready) return { ok: false, message: "Pagamentos ainda não configurados no servidor." };

  const parsed = checkoutSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, fieldErrors: { payer_email: parsed.error.issues[0].message } };
  const { plan_id, payer_email } = parsed.data;

  const { data: plan } = await ctx.supabase.from("plans").select("id, name, price_cents, is_active").eq("id", plan_id).maybeSingle();
  if (!plan?.is_active) return { ok: false, message: "Plano indisponível." };
  if (ctx.subscription?.plan_id === plan_id && ctx.subscription.status === "active" && !ctx.subscription.cancel_at) {
    return { ok: false, message: `Você já assina o plano ${plan.name}.` };
  }

  const db = createAdminClient();
  // Evita cliques repetidos: reaproveita um checkout pendente recente do mesmo plano.
  const { data: recent } = await db.from("billing_checkouts").select("id, init_point")
    .eq("organization_id", ctx.org.id).eq("plan_id", plan_id).eq("status", "pending").eq("payer_email", payer_email)
    .gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (recent?.init_point) redirect(recent.init_point);

  const { data: checkout, error: insErr } = await db.from("billing_checkouts").insert({
    organization_id: ctx.org.id, plan_id, amount_cents: plan.price_cents, payer_email, mode: cfg.mode, created_by: ctx.userId,
  }).select("id").single();
  if (insErr || !checkout) return { ok: false, message: "Não foi possível iniciar a contratação." };

  const mp = new MercadoPagoClient(cfg.accessToken);
  let initPoint: string;
  try {
    const pre = await mp.createPreapproval({
      reason: `Funcionário 24h — Plano ${plan.name}`,
      externalReference: externalReference(checkout.id),
      payerEmail: payer_email,
      amountBrl: plan.price_cents / 100,
      backUrl: `${cfg.appUrl}/assinatura?checkout=${checkout.id}`,
      idempotencyKey: checkout.id,
    });
    if (!pre.init_point) throw new MercadoPagoError(502, "Mercado Pago não retornou o link de pagamento.");
    initPoint = pre.init_point;
    await db.from("billing_checkouts").update({ provider_subscription_id: pre.id, init_point: pre.init_point, status: "pending" })
      .eq("id", checkout.id);
  } catch (e) {
    await db.from("billing_checkouts").update({ status: "failed" }).eq("id", checkout.id);
    console.error("checkout mercadopago:", e instanceof Error ? e.message : e);
    const msg = e instanceof MercadoPagoError && e.status === 400
      ? "O Mercado Pago recusou os dados. Confira o e-mail do pagador (em modo teste, use o e-mail de um usuário de teste comprador)."
      : "Não foi possível falar com o Mercado Pago agora. Tente novamente em instantes.";
    return { ok: false, message: msg };
  }
  redirect(initPoint);
}

/** Sincroniza um checkout com o Mercado Pago (usado no retorno do pagamento). */
export async function syncCheckout(checkoutId: string) {
  const ctx = await requireOrg(["owner", "admin"]);
  const cfg = billingConfig();
  if (!cfg.ready || !/^[0-9a-f-]{36}$/i.test(checkoutId)) return;
  const db = createAdminClient();
  const { data: co } = await db.from("billing_checkouts").select("provider_subscription_id")
    .eq("id", checkoutId).eq("organization_id", ctx.org.id).maybeSingle();
  if (!co?.provider_subscription_id) return;
  try {
    await syncPreapproval(co.provider_subscription_id, { mp: new MercadoPagoClient(cfg.accessToken), store: supabaseBillingStore(db) });
  } catch (e) {
    console.error("sincronizar checkout:", e instanceof Error ? e.message : e);
  }
}

/** Cancela a assinatura vigente. O acesso continua até o fim do período pago. */
export async function cancelSubscription(_: ActionState, form: FormData): Promise<ActionState> {
  const { ctx, error } = await ownerCtx();
  if (!ctx) return { ok: false, message: error };
  if (form.get("confirm") !== "CANCELAR") return { ok: false, fieldErrors: { confirm: 'Digite CANCELAR para confirmar.' } };
  const cfg = billingConfig();
  const subId = ctx.subscription?.provider_subscription_id;
  if (!cfg.ready || !subId) return { ok: false, message: "Não há assinatura paga ativa para cancelar." };
  const mp = new MercadoPagoClient(cfg.accessToken);
  try {
    await mp.cancelPreapproval(subId);
    await syncPreapproval(subId, { mp, store: supabaseBillingStore(createAdminClient()) });
  } catch (e) {
    console.error("cancelar assinatura:", e instanceof Error ? e.message : e);
    return { ok: false, message: "Não foi possível cancelar agora. Tente novamente em instantes." };
  }
  revalidatePath("/assinatura");
  return { ok: true, message: "Assinatura cancelada. Você mantém o acesso até o fim do período já pago." };
}
