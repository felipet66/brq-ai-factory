const PRIVATE_KEY_HEADER = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/u;
const RECOGNIZABLE_TOKEN =
  /(?:\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b)/u;
const LITERAL_CREDENTIAL_ASSIGNMENT =
  /(?:\b(?:api[_-]?key|client[_-]?secret|password|secret|access[_-]?token)\b|\b(?:OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN)\b)\s*[:=]\s*["'][A-Za-z0-9+/_=@.-]{16,}["']/iu;

export type ContentSafetyFailureReason =
  'PRIVATE_KEY_MATERIAL' | 'RECOGNIZABLE_TOKEN' | 'LITERAL_CREDENTIAL';

export class ContentSafetyFailure extends Error {
  readonly reason: ContentSafetyFailureReason;

  constructor(reason: ContentSafetyFailureReason) {
    super('O conteúdo contém material sensível que não pode ser materializado.');
    this.name = 'ContentSafetyFailure';
    this.reason = reason;
  }
}

export function assertSafeWorkspaceContent(content: string): void {
  if (PRIVATE_KEY_HEADER.test(content)) throw new ContentSafetyFailure('PRIVATE_KEY_MATERIAL');
  if (RECOGNIZABLE_TOKEN.test(content)) throw new ContentSafetyFailure('RECOGNIZABLE_TOKEN');
  if (LITERAL_CREDENTIAL_ASSIGNMENT.test(content)) {
    throw new ContentSafetyFailure('LITERAL_CREDENTIAL');
  }
}
