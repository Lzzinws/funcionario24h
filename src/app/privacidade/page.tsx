import type { Metadata } from "next";
import { LegalPage } from "@/components/app/legal-page";

export const metadata: Metadata = { title: "Política de privacidade" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidade">
      <h2>Papéis segundo a LGPD</h2>
      <p>A empresa cliente é a controladora dos dados dos seus contatos. O Funcionário 24h atua como operador, tratando esses dados somente para prestar o serviço contratado.</p>
      <h2>Dados tratados</h2>
      <ul>
        <li>Conta: nome, e-mail e dados de acesso dos usuários da plataforma.</li>
        <li>Atendimento: nome, telefone e mensagens trocadas entre a empresa cliente e seus contatos pelo WhatsApp.</li>
        <li>Uso: registros técnicos e de consumo de IA, sem conteúdo das conversas.</li>
      </ul>
      <h2>Como protegemos</h2>
      <ul>
        <li>Isolamento por empresa no banco de dados (Row Level Security): uma empresa nunca acessa dados de outra.</li>
        <li>Credenciais de integração cifradas e acessíveis apenas pelo servidor.</li>
        <li>A equipe do Funcionário 24h visualiza apenas indicadores agregados, sem acesso ao conteúdo das conversas.</li>
        <li>Registro de auditoria das ações relevantes.</li>
      </ul>
      <h2>Inteligência artificial</h2>
      <p>As mensagens são processadas por um provedor de modelos de linguagem para gerar respostas. O conteúdo não é usado para treinar modelos, conforme os termos do provedor contratado.</p>
      <h2>Direitos dos titulares</h2>
      <p>Solicitações de acesso, correção, portabilidade e exclusão devem ser feitas à empresa controladora, que dispõe de ferramentas na plataforma para atendê-las.</p>
    </LegalPage>
  );
}
