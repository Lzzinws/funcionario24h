# Pagamentos — Mercado Pago (assinaturas)

## Como funciona

1. O proprietário clica em **Assinar** em `/assinatura`. O servidor grava um checkout (`billing_checkouts`) com o valor lido da tabela `plans` e cria uma assinatura `POST /preapproval` com `status: "pending"` e `external_reference = f24h:<id do checkout>`.
2. O cliente é levado ao `init_point` do Mercado Pago e cadastra o cartão.
3. O Mercado Pago chama `POST /api/webhooks/mercadopago`. O app:
   - valida o `x-signature` (HMAC-SHA256 do manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`);
   - registra o evento em `webhook_events`;
   - **consulta o estado real** na API (`GET /preapproval/{id}` ou `GET /authorized_payments/{id}`);
   - aplica no banco com as funções `billing_apply_subscription` e `billing_record_payment` (idempotentes, somente `service_role`).
4. Quando a assinatura fica `authorized`, o plano é ativado. Se era troca de plano, a assinatura antiga é cancelada no Mercado Pago. Se o novo plano tem menos funcionários, os excedentes são pausados.
5. Ao voltar do checkout (`/assinatura?checkout=<id>`), a página sincroniza na hora, sem depender só do webhook.

| Evento | Efeito |
|---|---|
| Assinatura `authorized` | plano contratado ativo, teste encerrado |
| Fatura com pagamento `approved` | período renovado (+1 mês) |
| Fatura `rejected` / estornada | assinatura em "pagamento pendente" (IA continua até a regularização) |
| Assinatura `canceled` | acesso até o fim do período pago |
| Assinatura `paused` | "pagamento pendente" |

## Variáveis no Vercel

| Variável | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token da aplicação (no teste: o da **conta de teste vendedora**) |
| `MP_WEBHOOK_SECRET` | Suas integrações → aplicação → Webhooks → Configurar notificações → assinatura secreta |
| `MP_MODE` | `test` enquanto testa; `live` só ao ativar cobranças reais |
| `SUPABASE_SERVICE_ROLE_KEY` | necessária para o webhook gravar no banco |

Depois de alterar variáveis, faça um novo deploy.

## Configurar o webhook no Mercado Pago

Em **Suas integrações → sua aplicação → Webhooks → Configurar notificações**:

- URL (modo teste e produção): `https://funcionario24h.vercel.app/api/webhooks/mercadopago`
- Eventos: **Planos e assinaturas** (`subscription_preapproval`, `subscription_authorized_payment`)
- Salve e copie a **assinatura secreta** para `MP_WEBHOOK_SECRET`.

## Roteiro de teste (antes de ativar pagamentos reais)

Pré-requisitos: em Suas integrações → **Contas de teste**, crie uma conta **Vendedor** e uma **Comprador** (país Brasil). Faça login com a conta vendedora, crie a aplicação e use as credenciais dela.

1. Configure as variáveis acima com `MP_MODE=test` e faça o deploy.
2. Entre no app como proprietário, abra **Plano e cobrança** e confira o aviso "Modo de teste".
3. Clique em **Assinar Profissional** usando como e-mail do pagador **o e-mail da conta de teste compradora** (o Mercado Pago recusa e-mails diferentes do pagador).
4. No checkout, entre com a conta compradora e pague com um **cartão de teste aprovado** (titular `APRO`).
5. Ao voltar para `/assinatura`, verifique: aviso "Pagamento confirmado", plano Profissional ativo, badge **Ativa**.
6. No Supabase, confira `billing_checkouts` (status `authorized`), `subscriptions` (plan_id `profissional`, status `active`), `webhook_events` (eventos com `processed_at` preenchido) e `audit_logs` (`billing.plan_activated`).
7. Troque para **Starter**: após aprovar, o plano muda, a assinatura anterior aparece cancelada no Mercado Pago e funcionários acima do limite ficam pausados.
8. Teste uma recusa: nova assinatura com cartão de teste titular `OTHE` → checkout não aprovado, plano não muda.
9. Cancele em **Cancelar assinatura** → badge "Cancelada — ativa até o fim do período".
10. Webhook com assinatura inválida (ex.: `curl -X POST .../api/webhooks/mercadopago -d '{}'`) deve responder **401**.

## Ativar cobranças reais

1. Troque `MP_ACCESS_TOKEN` pelo Access Token de **produção** da sua conta real.
2. Configure o webhook de produção com a mesma URL e copie a nova assinatura secreta.
3. `MP_MODE=live` e novo deploy.
4. Faça uma assinatura real de menor valor e cancele em seguida para validar.
