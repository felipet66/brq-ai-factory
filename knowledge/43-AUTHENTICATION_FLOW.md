# Authentication and Authorization Flow

## Objetivo

Documentar a fronteira de autenticação, autorização e ownership da Sprint 19 definida pelo
[ADR-029](ADR/ADR-029-AUTHENTICATION-AUTHORIZATION-BOUNDARY.md). A identidade pertence ao host
Next.js; os agentes, Orchestrator, Execution Engine, Execution Worker e Job Queue permanecem sem
conhecimento de usuário, sessão, cookie ou role.

O fluxo usa email e senha no MVP local, Better Auth com adapter Prisma, Argon2id e sessões
server-side revogáveis. OAuth, SSO, MFA e permission engine não integram esta Sprint.

## Better Auth versus Auth.js

A escolha foi reavaliada depois da aprovação do planejamento:

| Necessidade da AI Factory     | Better Auth                                   | Auth.js                                                                                     |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Email e senha local           | Fluxo integrado                               | Credentials exige que a aplicação implemente persistência e lifecycle de credenciais        |
| Database session              | Integrada ao adapter Prisma                   | Credentials não oferece a combinação desejada sem composição adicional e tende ao fluxo JWT |
| Logout revogável              | Remove a sessão persistida                    | Exige estratégia adicional quando Credentials usa JWT                                       |
| Cookie server-side            | Cookie opaco e `httpOnly`                     | Suportado, mas não elimina o trabalho customizado de Credentials                            |
| Superfície de código sensível | Menor para este escopo                        | Maior para hashing, account lookup e persistência de senha                                  |
| Trade-off                     | Quatro models técnicos e uma dependência nova | Integração histórica madura e menos tabelas no modo JWT                                     |

Better Auth foi escolhido porque atende o conjunto completo, e não por preferência genérica de
biblioteca. O token interno nunca é projetado para o contrato HTTP ou para componentes React. A
reavaliação usa as documentações oficiais de [Credentials do
Auth.js](https://authjs.dev/getting-started/authentication/credentials), [migração para Better
Auth](https://authjs.dev/getting-started/migrate-to-better-auth), [integração Next.js do Better
Auth](https://better-auth.com/docs/integrations/next) e [adapter
Prisma](https://better-auth.com/docs/adapters/prisma).

## Fronteira

```text
Frontend HTTP-only
  → Next.js page / Route Handler
    → authentication helpers no host
      → authenticated principal
        → application authorization policy
          → scoped Execution Repository / existing Dispatcher

Better Auth
  → Prisma adapter
    → User + Session + Account + Verification
```

Somente a aplicação resolve a sessão e interpreta `ADMIN` ou `USER`. O Execution Repository recebe
uma capability explícita de owner, leitura global ou lifecycle interno; ele não recebe cookies,
papéis ou objetos Better Auth.

## Login Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuário
    participant Login as "/login"
    participant Client as Auth client interno
    participant API as "POST /api/auth/login"
    participant Guard as Origin + Zod boundary
    participant Auth as Better Auth server
    participant DB as Prisma / SQLite

    User->>Login: informa email e senha
    Login->>Client: login(credentials)
    Client->>API: JSON same-origin
    API->>Guard: validar Origin, media type, bytes e schema
    Guard->>Auth: signInEmail(email, password)
    Auth->>DB: localizar credential account
    DB-->>Auth: password hash + User
    Auth->>Auth: verificar Argon2id
    alt credenciais válidas
        Auth->>DB: criar nova Session com expiração
        DB-->>Auth: sessão persistida
        Auth-->>API: safe user + Set-Cookie interno
        API-->>Client: envelope 200 + cookie httpOnly
        Client-->>Login: usuário autenticado
        Login-->>User: redirect para /
    else credenciais inválidas
        Auth-->>API: falha sem detalhe enumerável
        API-->>Client: 401 AUTHENTICATION_INVALID_CREDENTIALS
        Client-->>Login: erro genérico
        Login-->>User: email ou senha inválidos
    end
```

O endpoint devolve somente `id`, `name`, `email`, `role`, `createdAt` e `updatedAt`. Password,
hash, token, cookie e resposta completa da biblioteca são descartados na fronteira.

## Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> ABSENT
    ABSENT --> ACTIVE: login válido cria sessão nova
    ACTIVE --> ACTIVE: request protegido antes da expiração
    ACTIVE --> REVOKED: logout
    ACTIVE --> EXPIRED: limite absoluto de 8 horas
    ACTIVE --> INVALID: usuário ausente ou role desconhecida
    REVOKED --> ABSENT: cookie expirado
    EXPIRED --> ABSENT: cookie expirado
    INVALID --> ABSENT: sessão rejeitada
    ABSENT --> [*]
```

Não existe renovação automática nesta Sprint. Cada login válido emite uma nova sessão. Logout
revoga o registro server-side e expira o cookie; uma sessão expirada, revogada ou incoerente nunca
é convertida em principal.

O cookie é host-only, `httpOnly`, `sameSite=lax` e `secure` em produção. A origem confiável é
exatamente `BRQ_APP_ORIGIN`, e `BETTER_AUTH_SECRET` não possui fallback inseguro.

## Authorization Flow

```mermaid
flowchart TD
    REQUEST["Request para recurso protegido"] --> SESSION{"Sessão válida?"}
    SESSION -- Não --> UNAUTH["401 na API ou redirect /login"]
    SESSION -- Sim --> ROLE{"Role allowlisted"}
    ROLE -- Desconhecida --> CLOSED["Fail closed"]
    ROLE -- USER --> OP{"Operação"}
    ROLE -- ADMIN --> ADMIN{"Operação"}

    OP -- Criar --> OWN_CREATE["Persistir userId da sessão"]
    OP -- Ler --> OWNER_SCOPE["Repository OWNER scope"]
    OWNER_SCOPE --> FOUND{"Recurso do mesmo owner?"}
    FOUND -- Sim --> ALLOW["Permitir"]
    FOUND -- Não --> HIDE["404 para evitar enumeração"]

    ADMIN -- Criar --> ADMIN_CREATE["Persistir userId da sessão ADMIN"]
    ADMIN -- Ler --> GLOBAL["Repository GLOBAL_READ_ONLY"]
    GLOBAL --> ALLOW

    OWN_CREATE --> ALLOW
    ADMIN_CREATE --> ALLOW
```

`USER` e `ADMIN` podem iniciar workflows. O que muda é o alcance de leitura. Nenhuma policy confia
em `userId` do JSON, query string ou path. A leitura global do ADMIN não permite mutação global.

## Execution Ownership

```mermaid
erDiagram
    USER ||--o{ SESSION : "possui"
    USER ||--o{ ACCOUNT : "autentica por"
    USER ||--o{ EXECUTION_RECORD : "é owner de"
    EXECUTION_RECORD ||--o| EXECUTION_JOB : "possui"
    EXECUTION_RECORD ||--o{ EXECUTION_LIFECYCLE_EVENT : "registra"
    EXECUTION_RECORD ||--o| EXECUTION_OBSERVATION : "projeta"

    USER {
        string id PK
        string email UK
        string role
        datetime createdAt
        datetime updatedAt
    }
    SESSION {
        string id PK
        string userId FK
        string token UK
        datetime expiresAt
    }
    ACCOUNT {
        string id PK
        string userId FK
        string providerId
        string accountId
        string passwordHash
    }
    EXECUTION_RECORD {
        string id PK
        string userId FK
        string executionId UK
        string workflowId UK
        string status
    }
    EXECUTION_JOB {
        string id PK
        string executionRecordId FK
        string jobId UK
        string status
    }
```

`ExecutionJob` não duplica `userId`: seu owner é o owner do `ExecutionRecord`. Timeline, hashes,
lineage, provenance e métricas permanecem filhos do mesmo agregado. O `userId` é metadata de
ownership e não participa de `ExecutionRequest`, `executionId` ou hashes do workflow.

Registros anteriores à Sprint 19 são atribuídos pela migration a um usuário técnico legado
determinístico. Esse usuário preserva integridade referencial, não recebe senha e não representa
uma conta interativa.

## Protected API Flow

```mermaid
sequenceDiagram
    autonumber
    actor Caller
    participant API as Protected Route Handler
    participant Session as Authentication boundary
    participant Policy as Authorization policy
    participant Host as Composition root
    participant Repository as Execution Repository
    participant Dispatcher as Execution Dispatcher

    Caller->>API: request + cookie httpOnly
    API->>Session: resolve authenticated principal
    alt sem principal válido
        Session-->>API: AUTHENTICATION_REQUIRED
        API-->>Caller: 401 envelope sanitizado
    else principal válido
        Session-->>API: userId + ADMIN ou USER
        API->>Policy: autorizar método e recurso
        alt POST /api/executions
            Policy->>Host: criar capability OWNER(principal.userId)
            Host->>Dispatcher: dispatch request validada
            Dispatcher->>Repository: criar ExecutionRecord com owner da sessão
            Repository-->>API: executionId + jobId + QUEUED
            API-->>Caller: 202 Accepted
        else lookup ou listagem
            Policy->>Host: OWNER para USER ou GLOBAL_READ_ONLY para ADMIN
            Host->>Repository: query já escopada
            alt encontrado no scope
                Repository-->>API: read model minimizado
                API-->>Caller: 200
            else ausente ou cross-owner USER
                Repository-->>API: not found
                API-->>Caller: 404 sem revelar existência
            end
        end
    end
```

O mesmo guard protege `GET /api/executions`, detail, timeline e `GET /api/jobs/[id]`. O
`GET /api/health` e o login permanecem públicos. O Worker usa capability interna somente para
concluir o lifecycle de registros que já possuem owner; ele nunca atua como caller autenticado.

## Frontend Auth Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuário
    participant Browser
    participant Login as "/login"
    participant Pages as "Páginas protegidas"
    participant Profile as "/profile"
    participant Server as Session helper server-side
    participant API as HTTP API protegida

    User->>Browser: abre a aplicação
    Browser->>Pages: GET /, /executions ou detalhe
    Pages->>Server: requireAuthenticatedUser()
    alt sessão ausente ou expirada
        Server-->>Pages: redirect /login
        Pages-->>Browser: /login
        Browser->>Login: renderiza formulário
        User->>Login: autentica
        Login-->>Browser: redirect /
    else sessão válida
        Server-->>Pages: safe current user
        Pages-->>Browser: header + conteúdo protegido
    end

    User->>Browser: abre Profile
    Browser->>Profile: GET /profile
    Profile->>Server: requireAuthenticatedUser()
    Server-->>Profile: id, name, email, role e timestamps
    Profile-->>Browser: perfil seguro sem token ou hash

    Browser->>API: histórico, execução, job ou timeline
    API-->>Browser: resposta filtrada pelo principal
    User->>Browser: logout
    Browser->>API: POST /api/auth/logout
    API-->>Browser: sessão revogada + cookie expirado
    Browser-->>User: /login
```

As páginas são protegidas no servidor; esconder links no browser não autoriza operações. O header
mostra usuário atual, role, acesso a `/profile` e logout. O perfil é deliberadamente mínimo e não
expõe Session, Account, token, hash ou dados de workflow.

## Password e seed local

Argon2id usa memória de 19.456 KiB, duas iterações e paralelismo 1. O seed explícito:

```bash
BRQ_SEED_ADMIN_PASSWORD='senha-local-forte' \
BRQ_SEED_USER_PASSWORD='outra-senha-local-forte' \
npm run auth:seed
```

Os valores acima são placeholders e não devem ser copiados para um ambiente compartilhado. O seed
cria ou atualiza somente `admin@example.local` e `user@example.local`; nenhum password real fica
versionado. O host também exige `BETTER_AUTH_SECRET` e `BRQ_APP_ORIGIN` em `.env`.

## Logs e dados proibidos

Permitidos:

- request, execution, workflow e job IDs quando aplicável;
- `userId`, role validada e auth outcome;
- endpoint, status HTTP, duração e código de erro sanitizado.

Sempre proibidos:

- password e password hash;
- cookie e session token;
- authorization header e segredo do adapter;
- payload completo de login;
- prompts, knowledge, specifications, respostas da IA e artifacts.

## Limitações e riscos

- não há rate limiting, lockout ou CAPTCHA; brute force permanece risco antes de exposição pública;
- não há MFA, verificação de email, reset ou troca de senha;
- sessões e fila continuam limitadas ao desenho local/single-host do MVP;
- não existe administração completa de usuários ou audit log de identidade;
- o owner técnico de dados históricos não representa pessoa autenticável;
- uma nova estratégia de identidade corporativa exigirá ADR próprio, sem atravessar os módulos
  funcionais existentes.

## Fora do escopo

OAuth, Google, Microsoft Entra ID, SSO, LDAP, MFA, Organizations, Teams, multi-tenancy completo,
permission engine, API keys, rate limit, billing, audit log completo, Redis, session store externo,
alterações em agentes ou no pipeline funcional, chamadas reais à OpenAI e qualquer item da Sprint
20 permanecem fora do escopo.
