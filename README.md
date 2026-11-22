# Funcionário 24h

> Sua empresa nunca trabalha sozinha.

Plataforma SaaS multi-tenant de funcionários digitais com IA que atendem pelo WhatsApp em modelo de **autonomia assistida**: ações sensíveis só acontecem depois de aprovação humana.

Arquitetura, riscos e plano completo: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Status

| Fase | Situação |
|---|---|
| 1. Fundação, auth, banco, organizações | ✅ Pronta — schema completo, RLS, 8 migrations, 41 testes SQL |
| 2. Dashboard, navegação, identidade visual | ✅ Pronta — dados reais via `org_dashboard_stats` |
| 3. Funcionários | ✅ Pronta — CRUD, modelos, instruções versionadas, permissões por ferramenta, desempenho |
| Base de conhecimento | ✅ Pronta (texto). Upload de arquivos: pendente (Supabase Storage) |
| 4. Núcleo de IA | ✅ Pronta — orquestrador, 10 ferramentas com permissão/aprovação, proteção contra prompt injection, custos e franquia; tela "Testar funcionário" |
| 5. WhatsApp Cloud API | ⏳ Pendente — schema de integração, segredos e deduplicação prontos |
| 6–9 | ⏳ Pendente — aprovações, CRM e admin já têm regras e RPCs no banco, testadas |

Ainda **não** foi testado contra um projeto Supabase real (o banco foi validado em Postgres 16 local com um stub do schema `auth`).

## Núcleo de IA

- `src/lib/ai/orchestrator.ts` — pipeline de 11 etapas (empresa → cliente → funcionário → base → modelo → permissões → aprovação → registro → resposta).
- Modelo padrão `claude-opus-5-5` com esforço `low` (ajustáveis por `AI_MODEL` e `AI_EFFORT`) e fallback automático no servidor quando o modelo recusa.
- Ações sensíveis (agendamento, desconto, acompanhamento) **sempre** viram pedido de aprovação, independentemente da configuração.
- Variáveis necessárias no servidor: `ANTHROPIC_API_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.

## Rodando localmente

```bash
cp .env.example .env.local     # preencha as chaves do Supabase
npm install --legacy-peer-deps
npm run dev
```

Aplicar o banco em um projeto Supabase:

```bash
supabase link --project-ref SEU_REF
supabase db push               # aplica supabase/migrations/*
```

No painel do Supabase → Authentication → URL Configuration, adicione `https://SEU_DOMINIO/auth/callback` às Redirect URLs.

Para tornar alguém administrador da plataforma:

```sql
insert into public.platform_admins (user_id) values ('<uuid do usuário>');
```

## Testes

```bash
npm test            # unitários (vitest)
npm run test:db     # migrations + RLS em Postgres local (requer psql/postgres)
npm run typecheck
```

## Princípios de segurança

- Toda tabela de negócio tem `organization_id` e RLS. Acesso decidido por funções `security definer` no schema `private`.
- Segredos de integração, fila de jobs e eventos de webhook não têm nenhuma policy: só o servidor (`service_role`) acessa.
- Aprovações só mudam pela RPC `decide_approval`; tarefas que exigem aprovação são bloqueadas por constraint + trigger.
- "Venda ganha" exige usuário humano autenticado e evidência (a IA não pode confirmar venda).
- O admin da plataforma usa apenas funções agregadas (`admin_*`) e não tem policy de leitura sobre conversas, mensagens, contatos ou base de conhecimento.
- Alterações em funcionários, instruções e base são auditadas por trigger, independentemente da interface.
