/** Descrições legíveis dos eventos de auditoria. */
const LABELS: Record<string, string> = {
  "organization.created": "Empresa criada",
  "organization.active": "Conta reativada",
  "organization.suspended": "Conta suspensa",
  "approval.approved": "Solicitação aprovada",
  "approval.rejected": "Solicitação rejeitada",
  "approval.changes_requested": "Alterações solicitadas",
  "employee.created": "Funcionário criado",
  "employee.updated": "Funcionário atualizado",
  "employee.activated": "Funcionário ativado",
  "employee.deactivated": "Funcionário desativado",
  "employee.instructions_updated": "Instruções atualizadas",
  "knowledge.created": "Item adicionado à base",
  "knowledge.updated": "Item da base atualizado",
  "knowledge.deleted": "Item removido da base",
};
export const auditLabel = (action: string) => LABELS[action] ?? action;
