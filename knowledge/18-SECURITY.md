# Security

## Objetivo

Este documento define os requisitos mínimos de segurança do BRQ AI Factory.

A segurança deve fazer parte da arquitetura desde o início.

Nenhum agente ou componente deve assumir que uma entrada é confiável.

---

# Princípios

- Security by Design
- Privacy by Design
- Least Privilege
- Defense in Depth
- Secure by Default
- Zero Trust
- Data Minimization
- Human Review for Sensitive Actions

---

# Escopo do MVP

No MVP, a aplicação será utilizada apenas em ambientes permitidos.

Não devem ser utilizados:

- dados reais de clientes
- código confidencial de clientes
- credenciais corporativas
- informações pessoais
- documentos classificados
- conteúdos proibidos pelas políticas da BRQ

---

# Dados Permitidos

Utilizar:

- requisitos fictícios
- projetos demonstrativos
- dados sintéticos
- códigos criados especificamente para testes
- exemplos sem vínculo com clientes

---

# Segredos

Segredos devem permanecer em variáveis de ambiente.

Exemplos:

```text
OPENAI_API_KEY
DATABASE_URL
AUTH_SECRET
```

Nunca:

- salvar segredos no Git
- inserir segredos em prompts
- registrar segredos em logs
- exibir segredos no frontend
- armazenar segredos em arquivos Markdown

---

# Arquivos de Ambiente

O repositório deve possuir:

```text
.env.example
```

O arquivo real deve permanecer ignorado.

```gitignore
.env
.env.local
.env.production
```

---

# Comunicação com IA

O frontend nunca deve chamar diretamente o provider de IA.

Fluxo obrigatório:

```text
Frontend
↓
Backend
↓
Orchestrator
↓
AI Provider
```

A chave da API nunca deve ser enviada ao navegador.

---

# Validação de Entrada

Toda entrada deve ser validada.

Validar:

- tamanho
- formato
- tipo
- conteúdo
- campos obrigatórios
- caracteres perigosos
- arquivos enviados

Entradas inválidas devem ser rejeitadas antes de chegar ao Orchestrator.

---

# Prompt Injection

Demandas de usuários devem ser tratadas como conteúdo não confiável.

O sistema deve separar:

- instruções do sistema
- regras do agente
- contexto do projeto
- entrada do usuário

O conteúdo do usuário nunca deve substituir as regras do sistema.

Cada agente deve ser instruído a ignorar pedidos que tentem:

- alterar seu papel
- revelar prompts internos
- acessar segredos
- ignorar políticas
- executar ações fora do escopo
- modificar regras arquiteturais

---

# Saída dos Agentes

Toda resposta deve:

- passar por schema
- ser validada antes de persistência
- ser tratada como não confiável
- ser escapada antes de exibição
- ser analisada antes de virar código executável

Código gerado por IA não deve ser executado automaticamente no MVP.

---

# Execução de Código

O MVP não executará código arbitrário produzido por agentes.

Uma futura sandbox deve possuir:

- isolamento
- limite de CPU
- limite de memória
- limite de tempo
- sistema de arquivos temporário
- bloqueio de rede por padrão
- lista controlada de comandos
- descarte após execução

---

# Autenticação e Autorização

Quando a autenticação for implementada:

- toda rota privada deverá exigir autenticação
- usuários só poderão acessar seus projetos
- operações administrativas exigirão permissão específica
- ações sensíveis deverão ser auditadas

Modelo futuro:

- USER
- REVIEWER
- ADMIN

---

# API

A API deve implementar:

- validação de entrada
- tratamento seguro de erros
- rate limiting
- limites de payload
- autenticação
- autorização
- headers de segurança
- proteção contra abuso

Mensagens de erro não devem revelar detalhes internos.

Evitar:

```json
{
  "error": "SQLite failed at /Users/user/project/database.db"
}
```

Preferir:

```json
{
  "success": false,
  "errors": [
    {
      "code": "INTERNAL_ERROR",
      "message": "Não foi possível concluir a operação."
    }
  ]
}
```

---

# Banco de Dados

Regras:

- utilizar queries parametrizadas
- não montar SQL manual com entrada do usuário
- controlar acesso
- criar backups quando necessário
- evitar dados sensíveis
- definir política de retenção
- proteger arquivos locais do banco

---

# Dependências

Dependências devem:

- possuir origem confiável
- ser realmente necessárias
- permanecer atualizadas
- passar por verificação de vulnerabilidades
- evitar pacotes abandonados

Executar regularmente:

```bash
npm audit
```

Atualizações automáticas futuras podem utilizar ferramentas aprovadas.

---

# Logs

Logs nunca devem conter:

- segredos
- chaves de API
- senhas
- tokens de sessão
- prompts confidenciais
- código proprietário
- dados pessoais desnecessários

---

# Uploads

Quando uploads forem adicionados:

- validar extensão
- validar MIME type
- validar tamanho
- renomear arquivos
- bloquear execução
- armazenar fora da pasta pública
- analisar conteúdos quando necessário

---

# Exportação

Arquivos ZIP, Markdown ou PDF gerados devem:

- conter apenas artefatos autorizados
- utilizar nomes seguros
- impedir path traversal
- evitar dados internos desnecessários
- exigir autorização para download

---

# Revisão Humana

Toda saída crítica deve permitir revisão humana.

A IA não deve automaticamente:

- publicar código
- executar deploy
- aprovar Pull Request
- alterar infraestrutura
- excluir dados
- enviar informações externas

---

# Gestão de Incidentes

Em caso de incidente:

1. Interromper a execução afetada.
2. Preservar logs de auditoria.
3. Revogar credenciais comprometidas.
4. Identificar o escopo.
5. Corrigir a vulnerabilidade.
6. Registrar a decisão.
7. Comunicar responsáveis conforme política corporativa.

---

# Checklist de Segurança

Antes de uma entrega:

- [ ] Nenhum segredo foi versionado.
- [ ] Entradas estão validadas.
- [ ] Respostas da IA estão validadas.
- [ ] Rotas sensíveis estão protegidas.
- [ ] Logs não expõem dados.
- [ ] Dependências foram verificadas.
- [ ] Erros não revelam detalhes internos.
- [ ] Código gerado não é executado automaticamente.
- [ ] Documentação de segurança está atualizada.
