const DISALLOWED_TEXT_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const EVIDENT_SECRET =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\bgh[opusr]_[A-Za-z0-9]{20,}|\bglpat-[A-Za-z0-9_-]{20,}|\bnpm_[A-Za-z0-9]{20,}|\bAIza[0-9A-Za-z_-]{35}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:[^@\s/]{4,}@|(?:api[-_]?key|authorization|bearer|password|secret|token)\s*[:=]\s*(?:["'][^"'\s]{8,}["']|[A-Za-z0-9_./+=:@%!-]{12,}))/iu;

export function isWellFormedPreviewText(value: string): boolean {
  if (DISALLOWED_TEXT_CONTROL.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function containsEvidentPreviewSecret(value: string): boolean {
  return EVIDENT_SECRET.test(value);
}
