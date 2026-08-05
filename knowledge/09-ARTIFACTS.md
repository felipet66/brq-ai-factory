# Artifacts

## Objetivo

Padronizar todos os artefatos produzidos pelos agentes.

Todo agente deve produzir artefatos estruturados.

---

# Product Owner

Arquivos

story.md

acceptance.md

backlog.json

---

# Developer

Arquivos

implementation.md

source-code

readme.md

---

# QA

Arquivos

test-plan.md

playwright.spec.ts

quality-report.md

---

# Estrutura

Todo artefato possui:

id

name

type

agent

createdAt

content

version

---

# Versionamento

Toda nova execução gera uma nova versão do artefato.

Nunca sobrescrever versões antigas.

---

# Persistência

Todo artefato será armazenado no banco.

Opcionalmente poderá ser exportado para:

- Markdown
- PDF
- ZIP

---

# Objetivo

Permitir rastreabilidade completa de toda execução.

Cada artefato deverá indicar:

- qual agente o criou
- quando foi criado
- qual prompt foi utilizado
- qual modelo foi utilizado
