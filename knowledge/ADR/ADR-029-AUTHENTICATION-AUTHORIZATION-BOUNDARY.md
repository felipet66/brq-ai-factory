# ADR-029 — Authentication and Authorization Boundary

## Status

Accepted

## Date

2026-08-07

## Context

As Sprints anteriores tornaram execução, fila, histórico e timeline acessíveis por HTTP, mas não
possuem identidade autenticada nem ownership. Qualquer caller capaz de alcançar o host pode criar
um workflow ou consultar metadados persistidos por ID. A Sprint 19 precisa proteger Frontend e API
sem introduzir conceitos de usuário, sessão ou papel nos agentes, Orchestrator, Execution Engine,
Execution Worker ou Job Queue.

O fluxo local exige email e senha, sessões server-side revogáveis, cookies seguros, integração com
Next.js App Router e Prisma e testes sem serviço externo. OAuth, SSO, MFA, organizações,
multi-tenancy completo e um permission engine continuam fora do escopo.

O agregado `ExecutionRecord` já é a raiz durável de execução. `ExecutionJob` possui relação
um-para-um com esse registro; duplicar owner no job criaria duas fontes de verdade. A API não pode
aceitar `userId` do browser nem revelar a existência de recursos pertencentes a outro usuário.

## Authentication library re-evaluation

Better Auth e Auth.js foram reavaliados depois da aprovação inicial do planejamento:

| Critério           | Better Auth                                                                     | Auth.js                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Email e senha      | Fluxo integrado com credential account e hooks de password                      | Credentials não persiste credenciais por padrão; hashing, cadastro e lifecycle ficam para a aplicação      |
| Sessão desejada    | Sessões persistidas e revogáveis com adapter Prisma                             | O fluxo Credentials favorece JWT e conflita com a decisão de database sessions sem implementação adicional |
| Next.js App Router | Handler e API server-side suportados diretamente                                | Integração madura, mas o caso credentials exige composição customizada relevante                           |
| Prisma             | Adapter oficial e schema documentado para User, Session, Account e Verification | Adapter oficial, porém não elimina a lacuna de persistência do Credentials provider                        |
| Tokens no browser  | Cookie de sessão opaco; o token não integra o contrato HTTP público             | Possível, mas a combinação mais simples com Credentials usa sessão JWT                                     |
| Revogação          | Logout remove a sessão persistida                                               | Exigiria estratégia própria no desenho JWT ou outra composição de sessão                                   |
| Custo              | Nova dependência e quatro models técnicos mínimos                               | Menos models para JWT, mas mais código próprio no fluxo de senha adotado                                   |

A documentação oficial do Auth.js registra que Credentials não persiste dados por padrão e aponta
Better Auth como caminho recomendado para novos projetos e necessidades novas. Para esta
plataforma, a economia de código sensível, a sessão Prisma revogável e o fluxo integrado de
email/senha pesam mais do que usar Auth.js somente por sua maturidade histórica.

### Decision

Adotar Better Auth como infraestrutura de autenticação do host Next.js, com adapter Prisma e
email/senha local. Auth.js não é adotado nesta Sprint.

Essa escolha não transforma Better Auth em dependência de domínio. Sua configuração, projeções e
integrações ficam em `apps/web/src/server/auth/`; Route Handlers e Server Components consomem
somente helpers da aplicação. Nenhum workspace `core/`, `agents/` ou `shared/` importa a
biblioteca.

Referências da reavaliação:

- [Auth.js — Credentials](https://authjs.dev/getting-started/authentication/credentials);
- [Auth.js — Migrate to Better Auth](https://authjs.dev/getting-started/migrate-to-better-auth);
- [Better Auth — Next.js](https://better-auth.com/docs/integrations/next);
- [Better Auth — Prisma adapter](https://better-auth.com/docs/adapters/prisma);
- [Better Auth — Email and password](https://better-auth.com/docs/authentication/email-password);
- [Better Auth — Session management](https://better-auth.com/docs/concepts/session-management).

## Boundary decision

A identidade é resolvida na aplicação antes de qualquer operação protegida:

```text
Browser
  → Next.js Route Handler / Server Component
    → application authentication boundary
      → authenticated principal { userId, role, safe user }
        → authorization policy
          → owner-scoped or global-read repository capability
            → existing execution flow
```

A sessão autentica; a policy da aplicação autoriza. A API deriva `userId` exclusivamente da
sessão. Os payloads HTTP de execução, paginação, lookup e timeline não recebem owner.

O Execution Repository conhece apenas um owner ID opaco e modos explícitos de acesso:

- `OWNER`: cria e lê somente registros vinculados ao `userId` recebido do host;
- `GLOBAL_READ_ONLY`: permite ao ADMIN consultar qualquer registro sem autorizar mutações;
- `INTERNAL`: permite ao Worker e aos decorators técnicos avançar lifecycle sem conhecer sessão;
- qualquer combinação não autorizada falha de forma fechada.

O repository não interpreta roles, cookies ou sessões. A aplicação converte `ADMIN` ou `USER` na
capability apropriada. Assim, ownership é preservado na persistência sem transferir autenticação
para o core.

## User and authentication data

O modelo público mínimo de usuário contém:

- `id`;
- `email` único;
- `name`;
- `role`, limitado pela aplicação a `ADMIN` ou `USER`;
- `createdAt` e `updatedAt`.

O adapter exige quatro modelos técnicos normalizados:

- `User`: identidade e papel;
- `Session`: token opaco, expiração e relação com o usuário;
- `Account`: credential account com o password hash;
- `Verification`: estrutura mínima exigida pelo adapter, sem ativar reset ou verificação de email
  nesta Sprint.

`Account` e `Verification` não representam OAuth habilitado nem ampliam o domínio. Não existem
Organization, Team, Tenant, Permission, API Key ou Billing.

`ExecutionRecord.userId` é obrigatório e referencia `User` com integridade restritiva. A migration
atribui registros históricos a um usuário técnico legado determinístico antes de tornar a coluna
obrigatória. `ExecutionJob` herda o owner exclusivamente por sua relação com `ExecutionRecord`;
não existe uma coluna duplicada de owner no job.

## Password security

Senhas usam Argon2id por uma implementação consolidada; não existe algoritmo próprio. A
configuração inicial segue o mínimo da OWASP:

- memória: 19.456 KiB;
- iterações: 2;
- paralelismo: 1;
- salt aleatório fornecido pela implementação;
- comparação encapsulada pela função de verificação da biblioteca.

A política de criação e seed aceita senhas entre 12 e 128 caracteres. Na autenticação, o callback
de hash aceita qualquer candidato entre 1 e 128 caracteres porque o Better Auth também o invoca
como trabalho constante para contas inexistentes; isso evita um caminho distinguível para senhas
curtas sem relaxar a política de criação. Somente o hash integra `Account`; senha em texto puro
nunca é persistida, logada, devolvida pela API ou colocada na sessão. Falha de verificação retorna
a mesma resposta genérica para email inexistente e senha inválida, reduzindo enumeração.

O seed local cria `admin@example.local` e `user@example.local` somente quando executado
explicitamente. As senhas são obrigatoriamente fornecidas por `BRQ_SEED_ADMIN_PASSWORD` e
`BRQ_SEED_USER_PASSWORD`; não existem senhas padrão no código ou na documentação.

## Session model

A sessão é persistida no banco e associada a um único usuário:

- duração absoluta de 8 horas;
- sem renovação automática nesta Sprint;
- logout revoga a sessão no servidor e expira o cookie;
- sessão ausente, expirada, inválida ou ligada a role desconhecida é rejeitada;
- o browser recebe somente o cookie de sessão; o token não integra envelopes HTTP nem estado
  React;
- IP e user-agent não são retidos nesta Sprint para minimizar dados.

Cookies de sessão são `httpOnly`, `sameSite=lax`, host-only e `secure` em produção. O host valida
uma origem exata definida por `BRQ_APP_ORIGIN`; cookies cross-subdomain não são habilitados. O
segredo do adapter vem de `BETTER_AUTH_SECRET`, deve ter ao menos 32 caracteres e nunca possui
fallback de produção.

Login não reutiliza sessão fornecida pelo caller: a autenticação bem-sucedida emite uma nova
sessão. Logout e expiração encerram o lifecycle; session fixation e reutilização depois da
revogação são rejeitadas pelos testes de fronteira.

## Authorization and ownership

As policies iniciais são fechadas e deliberadamente pequenas:

| Operação                             | USER                                 | ADMIN                               |
| ------------------------------------ | ------------------------------------ | ----------------------------------- |
| Criar execução                       | Permitido; owner é a própria sessão  | Permitido; owner é a própria sessão |
| Listar execuções                     | Somente próprias                     | Todas                               |
| Consultar execução por ID            | Somente própria                      | Qualquer uma                        |
| Consultar timeline                   | Somente de execução própria          | Qualquer uma                        |
| Consultar job                        | Somente associado a execução própria | Qualquer um                         |
| Usar páginas protegidas e `/profile` | Permitido                            | Permitido                           |

O lookup de um recurso que existe, mas pertence a outro `USER`, retorna `404`, e não `403`, para
evitar enumeração. `403` fica reservado a uma operação autenticada conhecida que a policy rejeite
sem depender da existência de um recurso. Ausência de sessão retorna `401` na API e redireciona
páginas protegidas para `/login`.

O `userId` enviado pelo cliente não faz parte do contrato. Campo desconhecido é rejeitado pelos
schemas estritos; mesmo que um caller tente incluí-lo, a associação persistida usa somente o
principal autenticado.

O Worker continua usando uma capability `INTERNAL` para concluir jobs já vinculados pelo dispatch
autenticado. Ele não resolve usuários nem amplia acesso público.

## HTTP boundary

Permanecem públicos:

- `GET /api/health`;
- `POST /api/auth/login`;
- `POST /api/auth/logout`, que produz resposta idempotente segura para a sessão apresentada.

Passam a exigir sessão:

- `POST /api/executions`;
- `GET /api/executions`;
- `GET /api/executions/[id]`;
- `GET /api/executions/[id]/timeline`;
- `GET /api/jobs/[id]`.

Os endpoints de autenticação usam wrappers próprios para manter o envelope HTTP da AI Factory e
nunca expõem o endpoint genérico do adapter, seu token interno ou operações fora do escopo. Login
devolve somente a projeção segura de `User`; logout devolve somente confirmação booleana.

Requests mutáveis exigem origem allowlisted e são protegidos por verificação de `Origin`, trusted
origins do adapter e cookie `sameSite=lax`. Os limites de body, validação Zod, headers de segurança,
`no-store`, tratamento uniforme de erro e logging sanitizado continuam no adapter HTTP.

## Frontend boundary

O Frontend adiciona:

- `/login`, com email, senha, loading e erro genérico;
- header autenticado com nome, role, link de perfil e logout;
- proteção server-side da homepage, histórico e detalhe;
- `/profile`, também protegido server-side, contendo apenas ID, nome, email, role e timestamps
  seguros da conta.

Server Components recebem a projeção segura da sessão. Componentes React não recebem token,
password hash, cookie, Account, Session ou objeto Better Auth. O client interno permanece como
único ponto de `fetch`; valores são renderizados como texto React e
`dangerouslySetInnerHTML` continua proibido.

Execution History continua filtrado pelo repository no servidor. Ocultar dados no React não é uma
barreira de autorização.

## Observability and logging

Logs de autenticação usam allowlist de:

- `requestId` e endpoint;
- `userId`, quando autenticado;
- `role` validada;
- outcome e código sanitizado;
- status HTTP e duração.

É sempre proibido registrar password, password hash, cookie, session token, authorization header,
payload de login, email digitado, resposta completa do adapter ou segredo de configuração.

Os eventos, timeline, hashes, métricas e contratos das Sprints anteriores permanecem inalterados.
Identidade e autorização não entram nos hashes funcionais do workflow. `userId` é metadata de
ownership e não muda `ExecutionRequest`, `executionId`, lineage ou provenance.

## Security posture and accepted risks

- CSRF é mitigado por `Origin` exata, trusted origins, SameSite e POST para mutações;
- cookies seguros e sessão server-side evitam expor bearer tokens à camada de apresentação;
- Argon2id protege hashes em repouso;
- schemas estritos e derivação server-side do owner impedem privilege escalation por payload;
- owner-scoped queries e `404` em cross-owner reduzem enumeração;
- projeções explícitas impedem que campos internos do adapter cheguem ao Frontend;
- segredo ausente ou configuração de origem inválida torna autenticação indisponível de modo
  fail-closed.

Riscos aceitos:

- não há rate limiting ou lockout; brute force deve ser mitigado antes de exposição pública;
- não há MFA, email verification ou password reset;
- SQLite e sessões no banco continuam adequados apenas ao host local/single-instance;
- não existe audit log completo de identidade;
- o usuário técnico legado preserva ownership de registros anteriores, mas não representa uma
  pessoa autenticável;
- a migration e o seed local não criam credenciais de produção.
- o seed é uma operação local explícita e bloqueia `NODE_ENV=production`; sua segurança operacional
  ainda depende de `NODE_ENV` e `DATABASE_URL` estarem corretamente configurados pelo host;
- identificadores técnicos de workflow ainda integram o contrato HTTP legado e possuem unicidade
  global no banco; um caller autenticado pode observar uma diferença entre colisão e criação sem
  receber o recurso de outro owner. A geração desses identificadores deve migrar para o backend em
  uma evolução contratual específica, sem ser antecipada nesta Sprint.

## Consequences

- toda criação e leitura operacional passa a exigir principal autenticado;
- USER recebe isolamento por owner e ADMIN recebe leitura global explícita;
- sessões podem ser revogadas sem depender de token de longa duração no browser;
- o schema cresce com entidades técnicas requeridas pelo adapter e `ExecutionRecord.userId`;
- o host mantém a composição de identidade; o núcleo funcional permanece inalterado;
- o seed local permite testes manuais sem credenciais versionadas;
- recursos antigos recebem um owner técnico determinístico durante a migration;
- falha de configuração de autenticação bloqueia rotas protegidas em vez de liberar acesso.

## Out of scope

- OAuth Google ou Microsoft, Entra ID, SSO e LDAP;
- MFA, verificação de email, recuperação ou troca de senha;
- Organizations, Teams, tenants, RBAC genérico ou permission engine;
- API keys, tokens públicos ou autenticação entre serviços;
- rate limit, lockout, CAPTCHA e proteção distribuída contra brute force;
- audit log completo, billing e administração complexa de usuários;
- Redis ou session store externo;
- alterações em Product Owner, Developer, QA, Prompt Builder, Response Validator, Business
  Validations, prompt assets, output contracts ou runtime prompt budget;
- alterações em Job Queue, Execution Worker, Execution Engine ou Orchestrator;
- chamadas reais à OpenAI;
- qualquer item da Sprint 20.
