/** Situação efetiva da assinatura (considera fim do teste e cancelamento agendado). */
export type SubscriptionLike = {
  status: string;
  trial_ends_at: string | null;
  current_period_end: string;
  cancel_at?: string | null;
};

export type EffectiveState = "trial" | "trial_expired" | "active" | "canceling" | "past_due" | "inactive";

export function effectiveState(sub: SubscriptionLike | null, now = new Date()): EffectiveState {
  if (!sub) return "inactive";
  const t = now.getTime();
  if (sub.status === "trialing") {
    return sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() < t ? "trial_expired" : "trial";
  }
  if (sub.status === "active") {
    if (sub.cancel_at) return new Date(sub.cancel_at).getTime() > t ? "canceling" : "inactive";
    return "active";
  }
  if (sub.status === "past_due") return "past_due";
  return "inactive";
}

/** Os funcionários digitais só atendem nestes estados. */
export const canOperate = (s: EffectiveState) => s === "trial" || s === "active" || s === "canceling" || s === "past_due";
