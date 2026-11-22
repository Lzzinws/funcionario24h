import { NextResponse, type NextRequest } from "next/server";
import { billingConfig } from "@/lib/billing/config";
import { verifyMercadoPagoSignature } from "@/lib/billing/signature";
import { MercadoPagoClient, MercadoPagoError } from "@/lib/billing/mercadopago";
import { parseTopic, syncAuthorizedPayment, syncPreapproval } from "@/lib/billing/service";
import { supabaseBillingStore } from "@/lib/billing/supabase-store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Webhook do Mercado Pago (assinaturas).
 * 1. Valida x-signature (HMAC) — sem assinatura válida, nada é processado.
 * 2. Registra o evento (deduplicação e auditoria técnica).
 * 3. Consulta o estado REAL no Mercado Pago e aplica no banco (idempotente).
 * Responde 200 em sucesso; 500 em falha temporária para o Mercado Pago reenviar.
 */
export async function POST(request: NextRequest) {
  const cfg = billingConfig();
  if (!cfg.ready) return NextResponse.json({ error: "cobrança não configurada" }, { status: 503 });

  const url = request.nextUrl;
  const raw = await request.text();
  let body: { type?: string; topic?: string; action?: string; live_mode?: boolean; data?: { id?: string | number } } = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const dataId = url.searchParams.get("data.id") ?? (body.data?.id != null ? String(body.data.id) : null);
  const type = url.searchParams.get("type") ?? body.type ?? body.topic ?? null;
  const requestId = request.headers.get("x-request-id");

  const sig = verifyMercadoPagoSignature({
    xSignature: request.headers.get("x-signature"), xRequestId: requestId, dataId, secret: cfg.webhookSecret,
  });
  if (!sig.valid) {
    console.warn("webhook mercadopago rejeitado:", sig.reason);
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }
  if (!dataId || !/^[A-Za-z0-9_-]{1,64}$/.test(dataId)) return NextResponse.json({ error: "data.id inválido" }, { status: 400 });

  const db = createAdminClient();
  const eventKey = `mercadopago:${type}:${dataId}:${requestId ?? body.action ?? "na"}`;
  await db.from("webhook_events").upsert(
    { provider: "mercadopago", event_key: eventKey, payload: body },
    { onConflict: "event_key", ignoreDuplicates: true },
  );

  const topic = parseTopic(type);
  if (topic === "ignored") return NextResponse.json({ ok: true, ignored: type });

  const deps = { mp: new MercadoPagoClient(cfg.accessToken), store: supabaseBillingStore(db) };
  try {
    if (topic === "subscription_preapproval") await syncPreapproval(dataId, deps);
    else await syncAuthorizedPayment(dataId, deps);
    await db.from("webhook_events").update({ processed_at: new Date().toISOString(), error: null }).eq("event_key", eventKey);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("webhook_events").update({ error: message.slice(0, 1000) }).eq("event_key", eventKey);
    // Assinatura de outro sistema/conta (checkout desconhecido): não adianta reenviar.
    if (message.includes("Checkout desconhecido")) return NextResponse.json({ ok: true, unknown: true });
    const retry = !(e instanceof MercadoPagoError) || e.retryable;
    console.error("webhook mercadopago:", message);
    return NextResponse.json({ error: "falha ao processar" }, { status: retry ? 500 : 200 });
  }
}
