import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valida o cabeçalho x-signature do Mercado Pago (documentação oficial):
 *   x-signature: ts=<timestamp>,v1=<hmac>
 *   manifesto:   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *   v1 = HMAC-SHA256(segredo, manifesto) em hexadecimal.
 * Pares ausentes são omitidos do manifesto; data.id alfanumérico vai em minúsculas.
 * Também rejeita notificações com timestamp muito antigo (replay).
 */
export function verifyMercadoPagoSignature(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
  nowMs?: number;
  toleranceMs?: number;
}): { valid: boolean; reason?: string } {
  const { xSignature, xRequestId, dataId, secret } = args;
  if (!secret) return { valid: false, reason: "segredo não configurado" };
  if (!xSignature) return { valid: false, reason: "cabeçalho x-signature ausente" };

  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k.trim(), v.join("=").trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !/^[0-9a-f]+$/i.test(v1)) return { valid: false, reason: "x-signature malformado" };

  let manifest = "";
  if (dataId) manifest += `id:${/[a-z]/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1.toLowerCase(), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "assinatura não confere" };

  // ts pode vir em segundos ou milissegundos.
  const tolerance = args.toleranceMs ?? 15 * 60_000;
  const tsMs = ts.length <= 10 ? Number(ts) * 1000 : Number(ts);
  const now = args.nowMs ?? Date.now();
  if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > tolerance) return { valid: false, reason: "notificação expirada" };
  return { valid: true };
}
