# Orchestrator

## Objetivo

O Orchestrator é o cérebro do BRQ AI Factory.

Nenhuma execução acontece sem passar por ele.

---

# Responsabilidades

- iniciar pipeline
- controlar ordem
- validar contratos
- registrar logs
- persistir artefatos
- tratar erros
- executar retries

---

# Pipeline

Nova Demanda

↓

Criar Execution

↓

Executar Product Owner

↓

Persistir

↓

Executar Developer

↓

Persistir

↓

Executar QA

↓

Persistir

↓

Finalizar

---

# Estados

Estados canônicos de `Execution`:

- `CREATED`
- `RUNNING`
- `REQUIRES_REVIEW`
- `SUCCESS`
- `FAILED`
- `CANCELLED`

Transições permitidas:

| Origem            | Destinos                                            |
| ----------------- | --------------------------------------------------- |
| `CREATED`         | `RUNNING`, `CANCELLED`                              |
| `RUNNING`         | `REQUIRES_REVIEW`, `SUCCESS`, `FAILED`, `CANCELLED` |
| `REQUIRES_REVIEW` | `RUNNING`, `FAILED`, `CANCELLED`                    |
| `FAILED`          | `RUNNING`                                           |

`SUCCESS` e `CANCELLED` são estados terminais.

`FAILED → RUNNING` representa exclusivamente uma retomada explícita e nunca pode ocorrer automaticamente.

`REQUIRES_REVIEW → RUNNING` deverá exigir uma resolução humana auditável. A implementação de usuários, auditoria e do fluxo de revisão pertence a Sprints posteriores.

---

# Retry

Cada agente poderá ser executado novamente.

Sem reiniciar toda a pipeline.

Retry automático encerra a tentativa atual e cria uma nova `AgentExecution`, com `attempt` incrementado, dentro da mesma `Execution`. `RETRY` é um evento, não um estado.

Essa regra descreve retries funcionais de agente. O `AIProvider` pode repetir internamente apenas uma falha de conexão sem resposta HTTP válida; essas tentativas técnicas permanecem dentro da mesma chamada e não criam `AgentExecution`. Qualquer resposta HTTP, recusa ou conteúdo inválido retorna sem retry técnico.

---

# Contrato

Entrada

Execution

↓

Saída

Artifacts

Logs

Status

---

# Regras

Nunca executar dois agentes simultaneamente no MVP.

Sempre persistir antes de chamar o próximo agente.

Nunca permitir comunicação direta entre agentes.

Toda decisão deverá ser registrada em logs.
