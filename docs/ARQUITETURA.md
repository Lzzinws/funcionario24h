# Funcionário 24h — Arquitetura e Plano de Implementação

> "Sua empresa nunca trabalha sozinha."

## 1. Análise da arquitetura proposta

A proposta é sólida e coerente para um SaaS multi-tenant na stack Vercel + Supabase. Decisões que tomei sobre os pontos em aberto:

| Tema | Decisão | Motivo |
|---|---|---|
| Backend | Next.js App Router: **Server Actions** para mutações do painel, **Route Handlers** (`/api/*`) para webhooks, worker e integrações | Um único deploy na Vercel; autorização sempre no servidor |
| Filas/workers | **Fila em Postgres** (`jobs` + `claim_jobs()` com `FOR UPDATE SKIP LOCKED`), processada por `/api/worker` (disparado logo após o webhook via `after()` e por Vercel Cron a cada minuto como rede de segurança) | Sem infraestrutura extra, transacional com os dados, retries com backoff, idempotente |
| IA | Interface `LLMProvider` com implementação Anthropic (Claude) por padrão; troca de provedor sem mexer no orquestrador | Isolar fornecedor, permitir controle de custo por modelo |
| Segredos de integração | Tabela `integration_secrets` **sem nenhuma policy RLS** (só `service_role` lê), valores cifrados com AES-256-GCM (`ENCRYPTION_KEY` no servidor) | Token do WhatsApp nunca chega ao navegador, nem mesmo ao dono da empresa |
| Admin da plataforma | Tabela `platform_admins`; o painel admin lê **apenas funções agregadas** (`admin_*`) que nunca retornam conteúdo de mensagens | Requisito de privacidade/LGPD |
| Aprovações | Ferramentas "sensíveis" nunca executam direto: criam `approvals` + `tasks(status=awaiting_approval)`. A execução só ocorre por `execute_approved_task` após `approvals.status='approved'` | Garantia no banco, não só na UI |
| Pagamentos | Modelo de dados + limites prontos; gateway (Stripe/Asaas/Mercado Pago) plugável na Fase 8 | Requer credenciais externas reais |

## 2. Estrutura de pastas

```
funcionario24h/
├── docs/                       # arquitetura, decisões, guia de configuração
├── supabase/
│   ├── migrations/             # SQL versionado (schema, RLS, funções)
│   └── tests/                  # testes de RLS/isolamento em SQL
├── src/
│   ├── app/
│   │   ├── (auth)/             # login, cadastro, recuperar senha
│   │   ├── (app)/              # painel da empresa (sidebar)
│   │   │   ├── dashboard/  funcionarios/  conversas/  aprovacoes/
│   │   │   ├── conhecimento/  crm/  relatorios/  whatsapp/  configuracoes/
│   │   ├── onboarding/         # assistente de primeiro acesso
│   │   ├── admin/              # painel do administrador da plataforma
│   │   └── api/
│   │       ├── webhooks/whatsapp/   # GET verificação + POST mensagens (assinatura HMAC)
│   │       ├── worker/              # processa a fila (protegido por CRON_SECRET)
│   │       └── auth/callback/       # troca de código do Supabase Auth
│   ├── components/
│   │   ├── ui/                 # primitivos estilo shadcn/ui
│   │   └── app/                # sidebar, cards, gráficos, tabelas
│   ├── lib/
│   │   ├── supabase/           # clients: browser, server (cookies), admin (service role)
│   │   ├── auth/               # getSession, requireOrg, requireRole
│   │   ├── ai/                 # orquestrador, provedores, ferramentas, guardrails
│   │   ├── whatsapp/           # cliente Cloud API, verificação de assinatura, parser
│   │   ├── queue/              # enqueue / claim / complete
│   │   ├── crypto/             # cifra de segredos
│   │   ├── plans/              # limites por plano
│   │   └── validation/         # schemas zod
│   └── middleware.ts           # refresh de sessão + proteção de rotas
└── tests/                      # vitest (unidade: orquestrador, guardrails, webhook)
```

## 3. Módulos e dependências

- `next@15`, `react@19`, `typescript`, `tailwindcss@4`
- `@supabase/ssr`, `@supabase/supabase-js` — auth por cookies e acesso a dados
- `zod` — validação de toda entrada (forms, webhooks, saída de ferramentas da IA)
- `@radix-ui/*` + `class-variance-authority` + `tailwind-merge` — componentes no padrão shadcn/ui
- `lucide-react` — ícones; `recharts` — gráficos
- `@anthropic-ai/sdk` — provedor de IA padrão
- `vitest` — testes unitários; `psql` — testes de RLS

Dependência entre módulos: `auth → organizations → employees → knowledge → ai/orchestrator → whatsapp → conversations/crm/approvals → reports/usage → plans/admin`.

## 4. Banco de dados (resumo)

Todas as tabelas de negócio possuem `organization_id` (FK, indexado) e RLS habilitada. Acesso decidido por funções `security definer` em schema `private`:

- `private.is_org_member(org_id)` / `private.has_org_role(org_id, roles[])`
- `private.is_platform_admin()`

Tabelas: `organizations`, `profiles`, `organization_members`, `plans`, `subscriptions`, `employee_templates`, `employees`, `employee_instructions` (versionadas), `knowledge_base`, `knowledge_documents`, `contacts`, `conversations`, `messages`, `leads`, `appointments`, `tasks`, `approvals`, `integrations`, `integration_secrets`, `webhook_events` (deduplicação), `jobs` (fila), `usage_records`, `audit_logs`, `platform_admins`.

Regras críticas no banco:
- `messages (integration_id, external_id)` único → mensagens duplicadas do WhatsApp são descartadas.
- `audit_logs` é *append-only* (sem policy de update/delete).
- Trigger em `employees` impede ultrapassar o limite de funcionários do plano.
- Trigger em `approvals` grava auditoria em cada decisão; tarefa só passa a `approved` via aprovação.

## 5. Riscos técnicos

| Risco | Mitigação |
|---|---|
| Vazamento entre empresas | RLS em todas as tabelas + testes SQL de isolamento; service role só em rotas de servidor que filtram por `organization_id` explicitamente |
| Prompt injection pelo cliente no WhatsApp | Instruções do funcionário nunca vêm da conversa; mensagens do cliente vão como conteúdo do usuário delimitado; ferramentas validadas por allowlist + zod; ações sensíveis sempre viram aprovação; detector heurístico registra tentativas |
| Custos de IA descontrolados | Limite de contexto (últimas N mensagens + resumo), `max_tokens`, cota mensal por plano em `usage_records`, corte automático com transferência para humano |
| Timeout serverless no webhook | Webhook só valida, deduplica e enfileira (responde 200 em ms); IA roda no worker |
| Janela de 24h do WhatsApp | Fora da janela só é possível enviar templates aprovados; o envio checa a janela e cria tarefa para humano |
| Entregas fora de ordem / reentregas da Meta | Deduplicação por `wamid`; status de entrega só avança (sent → delivered → read) |
| LGPD | Mínimo de dados, admin sem acesso a conteúdo, exportação/exclusão por contato, base legal registrada, logs de auditoria |
| Dependência de credenciais externas | Fluxos completos construídos e testados com testes unitários; status "não conectado" honesto até haver credenciais reais |

## 6. Plano de implementação

| Fase | Entrega | Critério de pronto |
|---|---|---|
| 1 | Fundação: Next.js, Supabase clients, migrations completas, RLS, auth, organizações, membros | Migrations aplicam limpas; testes SQL de isolamento passam; cadastro → cria org → painel |
| 2 | Layout, sidebar, identidade visual, dashboard com dados reais | Build sem erros, responsivo 375–1440px |
| 3 | CRUD de funcionários, modelos (Atendente/Vendedor/Agendador), permissões e ferramentas | Criar/editar/ativar funcionários respeitando limite do plano |
| 4 | Orquestrador de IA, ferramentas, guardrails, custos | Testes unitários do pipeline; teste de conversa no painel ("Testar funcionário") |
| 5 | WhatsApp Cloud API: conexão, webhook, envio, status, deduplicação | Testes com payloads oficiais; verificação real exige credenciais Meta |
| 6 | Conversas, CRM, aprovações | Fluxo aprovar/rejeitar/pedir alteração executa ou bloqueia tarefa |
| 7 | Relatórios e consumo | Métricas vindas de consultas reais |
| 8 | Planos, assinaturas, admin da plataforma | Admin vê agregados, nunca conteúdo |
| 9 | Testes, segurança, produção | Checklist de segurança, advisors do Supabase, deploy |

## 7. Configuração necessária (fornecida por você)

| Variável | Onde obter |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (somente servidor) |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Meta for Developers → App → WhatsApp |
| `CRON_SECRET` | `openssl rand -hex 32` |

O token de acesso e o `phone_number_id` de cada empresa são informados na tela de conexão do WhatsApp e gravados cifrados.
