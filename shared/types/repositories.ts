import type { Artifact, ArtifactCreateInput } from './artifact';
import type {
  AgentExecution,
  AgentExecutionCreateInput,
  Execution,
  ExecutionCreateInput,
  Project,
  ProjectCreateInput,
} from './domain';
import type { LogRecord, LogRecordCreateInput } from './log-record';
import type {
  PromptVersion,
  PromptVersionCreateInput,
  PromptVersionStatus,
} from './prompt-version';

export interface ProjectRepository {
  create(input: ProjectCreateInput): Promise<Project>;
  findById(id: string): Promise<Project | null>;
  list(): Promise<Project[]>;
  update(project: Project): Promise<Project>;
}

export interface ExecutionRepository {
  create(input: ExecutionCreateInput): Promise<Execution>;
  findById(id: string): Promise<Execution | null>;
  listByProject(projectId: string): Promise<Execution[]>;
  update(execution: Execution): Promise<Execution>;
}

export interface AgentExecutionRepository {
  create(input: AgentExecutionCreateInput): Promise<AgentExecution>;
  findById(id: string): Promise<AgentExecution | null>;
  listByExecution(executionId: string): Promise<AgentExecution[]>;
  update(agentExecution: AgentExecution): Promise<AgentExecution>;
}

export interface ArtifactRepository {
  createNextVersion(input: ArtifactCreateInput): Promise<Artifact>;
  findById(id: string): Promise<Artifact | null>;
  listByExecution(executionId: string): Promise<Artifact[]>;
}

export interface PromptVersionRepository {
  create(input: PromptVersionCreateInput): Promise<PromptVersion>;
  findById(id: string): Promise<PromptVersion | null>;
  findByAgentVersion(agent: string, version: string): Promise<PromptVersion | null>;
  listByAgent(agent: string): Promise<PromptVersion[]>;
  updateStatus(id: string, status: PromptVersionStatus): Promise<PromptVersion>;
}

export interface LogRepository {
  append(input: LogRecordCreateInput): Promise<LogRecord>;
  listByExecution(executionId: string): Promise<LogRecord[]>;
}
