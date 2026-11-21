import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ActionState } from "@/lib/action-result";

/** Mensagem de retorno de formulário, anunciada para leitores de tela. */
export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  const Icon = state.ok ? CheckCircle2 : AlertCircle;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`flex items-start gap-2 rounded-md px-3 py-2 text-[13px] ${state.ok ? "bg-mint-soft text-forest" : "bg-danger-soft text-danger"}`}
    >
      <Icon className="mt-px size-4 shrink-0" aria-hidden />
      {state.message}
    </p>
  );
}
