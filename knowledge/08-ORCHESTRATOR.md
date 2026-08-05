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

CREATED

RUNNING

WAITING

SUCCESS

FAILED

CANCELLED

---

# Retry

Cada agente poderá ser executado novamente.

Sem reiniciar toda a pipeline.

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
