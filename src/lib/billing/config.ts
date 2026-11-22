import "server-only";

/**
 * Configuração de cobrança. MP_MODE deixa explícito se as credenciais são
 * de teste (contas de teste do Mercado Pago) ou de produção.
 */
export function billingConfig() {
  const accessToken = process.env.MP_ACCESS_TOKEN?.trim() ?? "";
  const webhookSecret = process.env.MP_WEBHOOK_SECRET?.trim() ?? "";
  const mode: "test" | "live" = process.env.MP_MODE?.trim() === "live" ? "live" : "test";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || "https://funcionario24h.vercel.app").replace(/\/$/, "");
  const missing = [
    ["MP_ACCESS_TOKEN", accessToken],
    ["MP_WEBHOOK_SECRET", webhookSecret],
  ].filter(([, v]) => !v || v.length < 10).map(([k]) => k);
  return { accessToken, webhookSecret, mode, appUrl, ready: missing.length === 0, missing };
}
