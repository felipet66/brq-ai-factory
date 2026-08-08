import type { Dirent, Stats } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

export interface WorkspaceFileSystem {
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  mkdtemp(prefix: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<Dirent[]>;
  rename(source: string, destination: string): Promise<void>;
  rm(path: string): Promise<void>;
}

export const NODE_WORKSPACE_FILE_SYSTEM: WorkspaceFileSystem = Object.freeze({
  lstat,
  realpath,
  mkdtemp,
  mkdir: async (targetPath: string) => {
    await mkdir(targetPath, { recursive: false, mode: 0o700 });
  },
  writeFile: async (targetPath: string, content: string) => {
    await writeFile(targetPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  },
  readFile,
  readdir: async (targetPath: string) => readdir(targetPath, { withFileTypes: true }),
  rename,
  rm: async (targetPath: string) => {
    await rm(targetPath, { recursive: true, force: true });
  },
});

const SAFE_FILESYSTEM_ERROR_CODES = new Set([
  'EACCES',
  'EBUSY',
  'EDQUOT',
  'EEXIST',
  'EFBIG',
  'EINVAL',
  'EIO',
  'EISDIR',
  'ELOOP',
  'EMFILE',
  'ENAMETOOLONG',
  'ENFILE',
  'ENOENT',
  'ENOSPC',
  'ENOTDIR',
  'ENOTEMPTY',
  'EPERM',
  'EROFS',
  'EXDEV',
]);

export function filesystemErrorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    return typeof code === 'string' && SAFE_FILESYSTEM_ERROR_CODES.has(code) ? code : undefined;
  }
  return undefined;
}
