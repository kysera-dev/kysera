import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  readdir,
  stat,
  mkdir,
  remove,
  copy,
  move,
  ensureDir,
  ensureFile,
  pathExists,
  readJson,
  writeJson,
  outputFile,
  outputJson,
} from 'fs-extra';
import { resolve, relative, dirname, basename, extname, join } from 'node:path';
import { glob } from 'glob';
import { FileSystemError } from './errors.js';
import { logger } from './logger.js';
import { formatBytes } from './formatting.js';

/**
 * Normalize and validate a path to prevent traversal attacks
 * @throws FileSystemError if path traversal is detected
 */
export function safePath(basePath: string, userPath: string): string {
  const resolvedBase = resolve(basePath);
  const resolvedPath = resolve(basePath, userPath);

  if (!resolvedPath.startsWith(resolvedBase + '/') && resolvedPath !== resolvedBase) {
    throw new FileSystemError(
      `Path traversal detected: ${userPath}`,
      'PATH_TRAVERSAL',
      ['Ensure the path does not contain ".." sequences', 'Use absolute paths within the project']
    );
  }

  return resolvedPath;
}

/**
 * Check if a path is safe (no traversal)
 */
export function isPathSafe(basePath: string, userPath: string): boolean {
  try {
    safePath(basePath, userPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a path stays within allowed boundaries
 * Returns the resolved path if valid, throws otherwise
 */
export function validatePath(userPath: string, allowedBase?: string): string {
  const base = allowedBase || process.cwd();
  return safePath(base, userPath);
}

/**
 * Read file content
 */
export async function readFile(path: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
  try {
    return await fsReadFile(path, encoding);
  } catch (error: any) {
    throw new FileSystemError(`Failed to read file: ${path}`, 'READ_ERROR', undefined, path);
  }
}

/**
 * Write file content
 */
export async function writeFile(path: string, content: string): Promise<void> {
  try {
    await ensureDir(dirname(path));
    await fsWriteFile(path, content, 'utf8');
  } catch (error: any) {
    throw new FileSystemError(`Failed to write file: ${path}`, 'WRITE_ERROR', undefined, path);
  }
}

/**
 * Check if path exists
 */
export async function exists(path: string): Promise<boolean> {
  return pathExists(path);
}

/**
 * Check if path is a directory
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch (error) {
    logger.debug(`Failed to check if path is directory: ${path}`, error);
    return false;
  }
}

/**
 * Check if path is a file
 */
export async function isFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isFile();
  } catch (error) {
    logger.debug(`Failed to check if path is file: ${path}`, error);
    return false;
  }
}

/**
 * List files in directory
 */
export async function listFiles(
  dir: string,
  options: { recursive?: boolean; filter?: RegExp } = {}
): Promise<string[]> {
  try {
    const files: string[] = [];
    const items = await readdir(dir);

    for (const item of items) {
      const fullPath = join(dir, item);
      const isDir = await isDirectory(fullPath);

      if (isDir && options.recursive) {
        const subFiles = await listFiles(fullPath, options);
        files.push(...subFiles);
      } else if (!isDir) {
        if (!options.filter || options.filter.test(item)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  } catch (error: any) {
    throw new FileSystemError(`Failed to list files in directory: ${dir}`, 'LIST_ERROR', undefined, dir);
  }
}

/**
 * Find files matching pattern
 */
export async function findFiles(pattern: string, cwd?: string): Promise<string[]> {
  try {
    return await glob(pattern, {
      cwd: cwd || process.cwd(),
      absolute: true,
      nodir: true,
    });
  } catch (error: any) {
    throw new FileSystemError(`Failed to find files matching pattern: ${pattern}`, 'GLOB_ERROR');
  }
}

/**
 * Create directory
 */
export async function createDirectory(path: string): Promise<void> {
  try {
    await ensureDir(path);
  } catch (error: any) {
    throw new FileSystemError(`Failed to create directory: ${path}`, 'MKDIR_ERROR', undefined, path);
  }
}

/**
 * Remove file or directory
 */
export async function removePath(path: string): Promise<void> {
  try {
    await remove(path);
  } catch (error: any) {
    throw new FileSystemError(`Failed to remove: ${path}`, 'REMOVE_ERROR', undefined, path);
  }
}

/**
 * Copy file or directory
 */
export async function copyPath(src: string, dest: string): Promise<void> {
  try {
    await copy(src, dest, { overwrite: true });
  } catch (error: any) {
    throw new FileSystemError(`Failed to copy from ${src} to ${dest}`, 'COPY_ERROR');
  }
}

/**
 * Move file or directory
 */
export async function movePath(src: string, dest: string): Promise<void> {
  try {
    await move(src, dest, { overwrite: true });
  } catch (error: any) {
    throw new FileSystemError(`Failed to move from ${src} to ${dest}`, 'MOVE_ERROR');
  }
}

/**
 * Read JSON file
 */
export async function readJsonFile<T = any>(path: string): Promise<T> {
  try {
    return await readJson(path);
  } catch (error: any) {
    throw new FileSystemError(`Failed to read JSON file: ${path}`, 'JSON_READ_ERROR', undefined, path);
  }
}

/**
 * Write JSON file
 */
export async function writeJsonFile(path: string, data: any, spaces: number = 2): Promise<void> {
  try {
    await writeJson(path, data, { spaces });
  } catch (error: any) {
    throw new FileSystemError(`Failed to write JSON file: ${path}`, 'JSON_WRITE_ERROR', undefined, path);
  }
}

/**
 * Get file stats
 */
export async function getFileStats(path: string) {
  try {
    return await stat(path);
  } catch (error: any) {
    throw new FileSystemError(`Failed to get stats for: ${path}`, 'STAT_ERROR', undefined, path);
  }
}

/**
 * Get file size in human-readable format
 */
export async function getFileSize(path: string): Promise<string> {
  const stats = await getFileStats(path);
  return formatBytes(stats.size);
}

/**
 * Get relative path from CWD
 */
export function getRelativePath(path: string, from: string = process.cwd()): string {
  return relative(from, path);
}

/**
 * Get absolute path
 */
export function getAbsolutePath(path: string, from: string = process.cwd()): string {
  return resolve(from, path);
}

/**
 * Get file name without extension
 */
export function getFileName(path: string): string {
  const name = basename(path);
  const ext = extname(name);
  return name.slice(0, -ext.length);
}

/**
 * Get file extension
 */
export function getFileExtension(path: string): string {
  return extname(path);
}

/**
 * Get directory name
 */
export function getDirectoryName(path: string): string {
  return dirname(path);
}

/**
 * Join paths
 */
export function joinPaths(...paths: string[]): string {
  return join(...paths);
}

/**
 * Resolve paths
 */
export function resolvePaths(...paths: string[]): string {
  return resolve(...paths);
}

/**
 * Safe file operations with backup
 */
export class SafeFileOperations {
  private backups: Map<string, string> = new Map();

  async writeWithBackup(path: string, content: string): Promise<void> {
    // Create backup if file exists
    if (await exists(path)) {
      const backup = await readFile(path);
      this.backups.set(path, backup);
    }

    // Write new content
    await writeFile(path, content);
  }

  async rollback(path: string): Promise<void> {
    const backup = this.backups.get(path);
    if (backup !== undefined) {
      await writeFile(path, backup);
      this.backups.delete(path);
    }
  }

  async rollbackAll(): Promise<void> {
    for (const [path, content] of this.backups) {
      await writeFile(path, content);
    }
    this.backups.clear();
  }

  clearBackups(): void {
    this.backups.clear();
  }
}

/**
 * Watch file for changes (simplified version)
 */
export async function watchFile(path: string, callback: (event: 'change' | 'delete') => void): Promise<() => void> {
  const { watch } = await import('node:fs');
  const watcher = watch(path, (eventType, filename) => {
    if (eventType === 'change') {
      callback('change');
    } else if (eventType === 'rename') {
      // rename can mean delete
      exists(path).then((fileExists) => {
        if (!fileExists) {
          callback('delete');
        }
      });
    }
  });

  return () => watcher.close();
}
