import type { Metadata } from "next";
import { LegalPage } from "@/components/app/legal-page";

export const metadata: Metadata = { title: "Termos de uso" };

export default function TermsPage() {
  return (
    <LegalPage title="Termos de uso">
      <h2>O serviço</h2>
      <p>O Funcionário 24h oferece assistentes com inteligência artificial que atendem os contatos da empresa cliente pelo WhatsApp Business, conforme instruções e permissões definidas por ela.</p>
      <h2>Autonomia assistida</h2>
      <p>Ações sensíveis — descontos, pagamentos, reembolsos, confirmações de agendamento e contatos ativos — só são executadas após aprovação de um usuário da empresa cliente.</p>
      <h2>Responsabilidades da empresa cliente</h2>
      <ul>
        <li>Manter a base de conhecimento correta e atualizada.</li>
        <li>Cumprir as políticas do WhatsApp Business e obter o consentimento necessário dos contatos.</li>
        <li>Revisar as solicitações de aprovação.</li>
      </ul>
      <h2>Planos e limites</h2>
      <p>Cada plano define o número de funcionários digitais, números de WhatsApp e franquia mensal de uso de IA.</p>
    </LegalPage>
  );
}
