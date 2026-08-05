# Contributing

## Objetivo

Este documento define como pessoas e agentes de IA devem contribuir com o BRQ AI Factory.

Toda contribuição deve preservar:

- arquitetura
- qualidade
- segurança
- documentação
- rastreabilidade
- simplicidade

---

# Antes de Começar

Antes de alterar o projeto, leia:

1. `00-VISION.md`
2. `01-PROJECT_CONTEXT.md`
3. `02-ARCHITECTURE.md`
4. `03-WORKFLOW.md`
5. `04-TECH_STACK.md`
6. documentos relacionados ao módulo alterado
7. ADRs existentes

Não iniciar uma implementação sem compreender o contexto.

---

# Fluxo de Contribuição

```text
Identificar necessidade
↓
Consultar documentação
↓
Criar ou selecionar uma tarefa
↓
Planejar alteração
↓
Implementar
↓
Criar testes
↓
Atualizar documentação
↓
Executar validações
↓
Abrir Pull Request
↓
Revisar
↓
Fazer merge
```

---

# Tarefas

Toda alteração deve estar associada a uma tarefa.

A tarefa deve conter:

- contexto
- objetivo
- critérios de aceite
- escopo
- fora de escopo
- riscos conhecidos
- dependências

---

# Branches

Padrão sugerido:

```text
feature/
fix/
refactor/
docs/
test/
chore/
```

Exemplos:

```text
feature/create-execution
fix/agent-retry-status
docs/update-security
test/orchestrator-failure-flow
```

---

# Commits

Commits devem ser pequenos e possuir um objetivo claro.

Padrão recomendado:

```text
type(scope): description
```

Exemplos:

```text
feat(orchestrator): add sequential agent execution
fix(api): validate project identifier
docs(security): document prompt injection controls
test(qa-agent): add invalid response scenarios
```

Tipos:

- feat
- fix
- refactor
- docs
- test
- chore
- build
- ci
- perf

---

# Pull Request

Todo Pull Request deve conter:

## Contexto

Qual problema está sendo resolvido.

## Alterações

O que foi modificado.

## Testes

Como a alteração foi validada.

## Impactos

Quais módulos foram afetados.

## Riscos

Possíveis efeitos colaterais.

## Evidências

Screenshots, logs ou exemplos quando necessário.

## Checklist

- [ ] O código compila.
- [ ] Os testes passam.
- [ ] O lint passa.
- [ ] A tipagem passa.
- [ ] A documentação foi atualizada.
- [ ] Não existem segredos.
- [ ] O escopo foi respeitado.
- [ ] As decisões arquiteturais foram preservadas.

---

# Revisão de Código

A revisão deve verificar:

- aderência aos critérios de aceite
- clareza
- arquitetura
- segurança
- tipagem
- testes
- tratamento de erros
- observabilidade
- documentação
- compatibilidade

Comentários devem ser objetivos e respeitosos.

---

# Mudanças Arquiteturais

Mudanças arquiteturais não devem ser feitas silenciosamente.

Quando uma mudança afetar:

- camadas
- banco
- contratos
- agentes
- Orchestrator
- segurança
- stack
- fluxo principal

deve ser criado ou atualizado um ADR.

---

# Dependências

Antes de adicionar uma dependência, verificar:

- se a funcionalidade já existe no projeto
- se pode ser implementada de forma simples
- manutenção do pacote
- licença
- segurança
- tamanho
- compatibilidade

Toda dependência adicionada deve possuir justificativa.

---

# Documentação

A documentação deve ser atualizada no mesmo Pull Request da implementação.

Não deixar documentação para uma tarefa futura quando a alteração já mudou o comportamento atual.

---

# Testes

Toda correção de bug deve incluir um teste que reproduza o problema.

Toda funcionalidade nova deve incluir testes proporcionais ao risco.

Não remover testes apenas para permitir o merge.

---

# Contribuições de Agentes de IA

Agentes de IA devem atuar com escopo controlado.

Antes de implementar, devem apresentar um plano contendo:

- entendimento da tarefa
- arquivos afetados
- abordagem
- riscos
- testes necessários

Depois da implementação, devem informar:

- arquivos criados
- arquivos modificados
- decisões tomadas
- testes executados
- limitações
- próximos passos

---

# Regras para Codex

Ao iniciar uma tarefa, o Codex deve:

1. Ler o `README.md`.
2. Ler os documentos indicados pelo README.
3. Identificar o módulo responsável.
4. Consultar os ADRs.
5. Verificar testes existentes.
6. Criar um plano.
7. Implementar apenas o escopo aprovado.
8. Executar as validações.
9. Atualizar documentação.
10. Apresentar um resumo final.

O Codex deve interromper e solicitar decisão quando:

- documentos estiverem em conflito
- o requisito estiver ambíguo
- houver risco de segurança
- a mudança exigir decisão arquitetural
- faltar acesso ou configuração necessária
- a tarefa exigir dados confidenciais

---

# Proibições

Nenhum colaborador ou agente deve:

- inserir segredos
- utilizar dados reais de clientes sem autorização
- ignorar falhas de teste
- alterar arquitetura sem registro
- adicionar dependências desnecessárias
- executar código desconhecido
- enviar código confidencial a serviços não autorizados
- alterar arquivos fora do escopo sem informar
- fazer merge sem revisão

---

# Setup Local

O processo esperado será documentado no README.

Fluxo geral:

```bash
npm install
cp .env.example .env.local
npm run db:generate
npm run db:migrate
npm run dev
```

---

# Validações Locais

Antes de abrir um Pull Request:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Quando houver alteração de interface ou fluxo crítico:

```bash
npm run test:e2e
```

---

# Definition of Done

Uma contribuição está concluída quando:

- atende aos critérios de aceite
- respeita a arquitetura
- possui testes
- passou nas validações
- atualizou a documentação
- não introduziu vulnerabilidades conhecidas
- está pronta para revisão
- possui rastreabilidade suficiente
