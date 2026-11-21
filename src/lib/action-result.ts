/** Resultado padrão de Server Actions consumido pelos formulários. */
export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

export const initialActionState: ActionState = { ok: false };

/** Traduz erros do Postgres/Supabase para mensagens úteis ao usuário. */
export function friendlyDbError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "Não foi possível concluir. Tente novamente.";
  if (error.code === "P0001" || error.code === "22023") return error.message ?? "Operação inválida.";
  if (error.code === "23505") return "Já existe um registro com esses dados.";
  if (error.code === "42501") return "Você não tem permissão para esta ação.";
  if (error.code === "23514") return "Algum dado informado não é válido.";
  return "Não foi possível concluir. Tente novamente em instantes.";
}
