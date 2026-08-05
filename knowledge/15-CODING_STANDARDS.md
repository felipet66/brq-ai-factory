# Coding Standards

## Objetivo

Este documento define os padrões oficiais de desenvolvimento do BRQ AI Factory.

Todo código produzido por pessoas ou agentes de IA deve seguir estas diretrizes.

O objetivo é garantir:

- consistência
- legibilidade
- manutenção
- segurança
- testabilidade
- previsibilidade

Quando existir conflito entre uma implementação e este documento, este documento deve ser considerado a fonte de verdade.

---

# Princípios Gerais

O projeto deve seguir os seguintes princípios:

- Clean Code
- SOLID
- DRY
- KISS
- YAGNI
- Separation of Concerns
- Fail Fast
- Single Source of Truth

Evitar complexidade sem necessidade.

O MVP deve priorizar clareza e simplicidade.

---

# Linguagem

A linguagem oficial do projeto é:

- TypeScript

Não utilizar JavaScript sem tipagem em arquivos da aplicação.

Todo código deve ser compatível com o modo estrito do TypeScript.

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

---

# Convenções de Nomenclatura

## Arquivos

Utilizar `kebab-case`.

Exemplos:

```text
execution-service.ts
agent-runner.ts
project-card.tsx
artifact-repository.ts
```

---

## Variáveis e Funções

Utilizar `camelCase`.

```ts
const executionStatus = 'RUNNING';

function createExecution() {}
```

---

## Classes, Tipos, Interfaces e Componentes

Utilizar `PascalCase`.

```ts
type ExecutionStatus = 'CREATED' | 'RUNNING' | 'SUCCESS';

interface AgentExecution {}

class ArtifactRepository {}

function ProjectCard() {}
```

---

## Constantes Globais

Utilizar `UPPER_SNAKE_CASE`.

```ts
const DEFAULT_AGENT_TIMEOUT_MS = 60_000;
const MAX_RETRY_ATTEMPTS = 3;
```

---

## Booleanos

Nomes booleanos devem indicar claramente uma condição.

Utilizar prefixos como:

- is
- has
- can
- should
- was

```ts
const isRunning = true;
const hasArtifacts = false;
const canRetry = true;
```

---

# Organização de Código

Cada módulo deve possuir uma responsabilidade clara.

Estrutura recomendada:

```text
module/
├── components/
├── services/
├── repositories/
├── schemas/
├── types/
├── utils/
├── tests/
└── index.ts
```

Nem todas as pastas precisam existir em todos os módulos.

Criar apenas as pastas necessárias.

---

# Regras para Funções

Funções devem:

- possuir responsabilidade única
- ter nomes descritivos
- evitar efeitos colaterais ocultos
- possuir poucos parâmetros
- retornar valores previsíveis
- ser pequenas sempre que possível

Evitar:

```ts
function processData(data: any) {}
```

Preferir:

```ts
function validateAgentResponse(response: AgentResponse): ValidationResult {}
```

Quando uma função exigir muitos parâmetros, utilizar um objeto.

```ts
interface CreateExecutionInput {
  projectId: string;
  requirement: string;
  requestedBy?: string;
}

function createExecution(input: CreateExecutionInput) {}
```

---

# Tipagem

Não utilizar `any`, exceto quando tecnicamente inevitável e devidamente documentado.

Preferir:

- tipos explícitos
- unions
- generics
- schemas de validação
- `unknown` para dados externos

Exemplo:

```ts
function parseExternalResponse(input: unknown): AgentResponse {
  return agentResponseSchema.parse(input);
}
```

---

# Validação de Dados

Toda entrada externa deve ser validada.

Exemplos:

- body de requisições
- parâmetros de rota
- variáveis de ambiente
- respostas de modelos de IA
- dados recuperados do banco
- arquivos enviados

Utilizar schemas com Zod.

```ts
import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().min(10).max(5_000),
});
```

Nunca confiar diretamente em respostas do modelo de IA.

---

# Tratamento de Erros

Erros não devem ser ignorados.

Toda falha deve:

- ser registrada
- possuir uma mensagem clara
- conter contexto suficiente
- evitar exposição de dados sensíveis
- utilizar um tipo de erro conhecido

Exemplo:

```ts
export class AgentExecutionError extends Error {
  constructor(
    message: string,
    readonly agentName: string,
    readonly executionId: string,
  ) {
    super(message);
    this.name = 'AgentExecutionError';
  }
}
```

Evitar:

```ts
try {
  await executeAgent();
} catch {}
```

---

# Código Assíncrono

Utilizar `async/await`.

Evitar cadeias extensas de `.then()`.

```ts
const response = await agentRunner.execute(input);
```

Toda operação assíncrona relevante deve considerar:

- timeout
- retry
- cancelamento
- idempotência
- tratamento de erro

---

# Componentes React

Componentes devem:

- possuir responsabilidade única
- evitar lógica de negócio
- receber dados por propriedades
- manter estado local apenas quando necessário
- ser acessíveis
- ser testáveis

A lógica de negócio deve permanecer em:

- services
- hooks
- use cases
- orchestrator
- domain modules

---

# Server e Client Components

No Next.js, utilizar Server Components como padrão.

Adicionar `"use client"` apenas quando necessário.

Exemplos de necessidade:

- estado local
- eventos do navegador
- hooks do React
- APIs exclusivas do browser

Não transformar páginas inteiras em Client Components sem justificativa.

---

# API e Route Handlers

Route Handlers devem:

- validar entrada
- chamar um serviço ou use case
- formatar a resposta
- tratar erros

Eles não devem conter regras complexas de negócio.

Exemplo:

```ts
export async function POST(request: Request) {
  const body = await request.json();
  const input = createExecutionSchema.parse(body);

  const execution = await createExecution(input);

  return Response.json({
    success: true,
    data: execution,
    errors: [],
  });
}
```

---

# Banco de Dados

O acesso ao banco deve acontecer através de repositories ou services dedicados.

Evitar chamadas ao Prisma espalhadas por componentes e rotas.

Preferir:

```ts
executionRepository.create(input);
```

Evitar:

```ts
prisma.execution.create(...);
```

diretamente em qualquer camada da aplicação.

---

# Prompts

Prompts são código de negócio.

Todo prompt deve:

- estar versionado
- possuir responsabilidade clara
- definir entrada e saída
- exigir resposta estruturada
- evitar instruções ambíguas
- possuir exemplos quando necessário

Prompts não devem ficar diretamente dentro de arquivos de UI ou Route Handlers.

---

# Comentários

Comentários devem explicar o motivo, não repetir o código.

Evitar:

```ts
// Incrementa o contador
counter++;
```

Preferir:

```ts
// Mantemos o número da tentativa para permitir auditoria e análise de retries.
attemptNumber++;
```

---

# Importações

Preferir aliases configurados.

```ts
import { AgentRunner } from '@/agents/agent-runner';
```

Evitar caminhos relativos extensos.

```ts
import { AgentRunner } from '../../../../agents/agent-runner';
```

---

# Formatação e Qualidade

Ferramentas obrigatórias:

- ESLint
- Prettier
- TypeScript
- Husky
- lint-staged

Antes de um commit, executar:

```bash
npm run lint
npm run typecheck
npm run test
```

---

# Definition of Done

Uma tarefa só é considerada concluída quando:

- o código compila
- a tipagem está correta
- os testes passam
- não existem erros de lint
- os critérios de aceite foram atendidos
- a documentação foi atualizada
- não existem segredos expostos
- os logs necessários foram adicionados
- o código foi revisado

---

# Regras para Agentes de IA

Antes de modificar código, o agente deve:

1. Ler a documentação relacionada.
2. Identificar os módulos afetados.
3. Verificar decisões arquiteturais.
4. Planejar a implementação.
5. Alterar somente o necessário.
6. Criar ou atualizar testes.
7. Atualizar documentação quando aplicável.
8. Relatar arquivos modificados.
9. Relatar riscos e decisões tomadas.

O agente não deve:

- inventar bibliotecas sem necessidade
- mudar a arquitetura silenciosamente
- remover testes para fazer o build passar
- ignorar erros de TypeScript
- inserir segredos no código
- realizar refatorações fora do escopo sem autorização
