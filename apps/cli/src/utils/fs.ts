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
  outputJson
} from 'fs-extra'
import { resolve, relative, dirname, basename, extname, join } from 'node:path'
import { glob } from 'glob'
import { FileSystemError } from './errors.js'

/**
 * Read file content
 */
export async function readFile(path: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
  try {
    return await fsReadFile(path, encoding)
  } catch (error: any) {
    throw new FileSystemError(`Failed to read file: ${path}`, path)
  }
}

/**
 * Write file content
 */
export async function writeFile(path: string, content: string): Promise<void> {
  try {
    await ensureDir(dirname(path))
    await fsWriteFile(path, content, 'utf8')
  } catch (error: any) {
    throw new FileSystemError(`Failed to write file: ${path}`, path)
  }
}

/**
 * Check if path exists
 */
export async function exists(path: string): Promise<boolean> {
  return pathExists(path)
}

/**
 * Check if path is a directory
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    return stats.isDirectory()
  } catch {
    return false
  }
}

/**
 * Check if path is a file
 */
export async function isFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    return stats.isFile()
  } catch {
    return false
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
    const files: string[] = []
    const items = await readdir(dir)

    for (const item of items) {
      const fullPath = join(dir, item)
      const isDir = await isDirectory(fullPath)

      if (isDir && options.recursive) {
        const subFiles = await listFiles(fullPath, options)
        files.push(...subFiles)
      } else if (!isDir) {
        if (!options.filter || options.filter.test(item)) {
          files.push(fullPath)
        }
      }
    }

    return files
  } catch (error: any) {
    throw new FileSystemError(`Failed to list files in directory: ${dir}`, dir)
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
      nodir: true
    })
  } catch (error: any) {
    throw new FileSystemError(`Failed to find files matching pattern: ${pattern}`)
  }
}

/**
 * Create directory
 */
export async function createDirectory(path: string): Promise<void> {
  try {
    await ensureDir(path)
  } catch (error: any) {
    throw new FileSystemError(`Failed to create directory: ${path}`, path)
  }
}

/**
 * Remove file or directory
 */
export async function removePath(path: string): Promise<void> {
  try {
    await remove(path)
  } catch (error: any) {
    throw new FileSystemError(`Failed to remove: ${path}`, path)
  }
}

/**
 * Copy file or directory
 */
export async function copyPath(src: string, dest: string): Promise<void> {
  try {
    await copy(src, dest, { overwrite: true })
  } catch (error: any) {
    throw new FileSystemError(`Failed to copy from ${src} to ${dest}`)
  }
}

/**
 * Move file or directory
 */
export async function movePath(src: string, dest: string): Promise<void> {
  try {
    await move(src, dest, { overwrite: true })
  } catch (error: any) {
    throw new FileSystemError(`Failed to move from ${src} to ${dest}`)
  }
}

/**
 * Read JSON file
 */
export async function readJsonFile<T = any>(path: string): Promise<T> {
  try {
    return await readJson(path)
  } catch (error: any) {
    throw new FileSystemError(`Failed to read JSON file: ${path}`, path)
  }
}

/**
 * Write JSON file
 */
export async function writeJsonFile(path: string, data: any, spaces: number = 2): Promise<void> {
  try {
    await writeJson(path, data, { spaces })
  } catch (error: any) {
    throw new FileSystemError(`Failed to write JSON file: ${path}`, path)
  }
}

/**
 * Get file stats
 */
export async function getFileStats(path: string) {
  try {
    return await stat(path)
  } catch (error: any) {
    throw new FileSystemError(`Failed to get stats for: ${path}`, path)
  }
}

/**
 * Get file size in human-readable format
 */
export async function getFileSize(path: string): Promise<string> {
  const stats = await getFileStats(path)
  const bytes = stats.size

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}

/**
 * Get relative path from CWD
 */
export function getRelativePath(path: string, from: string = process.cwd()): string {
  return relative(from, path)
}

/**
 * Get absolute path
 */
export function getAbsolutePath(path: string, from: string = process.cwd()): string {
  return resolve(from, path)
}

/**
 * Get file name without extension
 */
export function getFileName(path: string): string {
  const name = basename(path)
  const ext = extname(name)
  return name.slice(0, -ext.length)
}

/**
 * Get file extension
 */
export function getFileExtension(path: string): string {
  return extname(path)
}

/**
 * Get directory name
 */
export function getDirectoryName(path: string): string {
  return dirname(path)
}

/**
 * Join paths
 */
export function joinPaths(...paths: string[]): string {
  return join(...paths)
}

/**
 * Resolve paths
 */
export function resolvePaths(...paths: string[]): string {
  return resolve(...paths)
}

/**
 * Safe file operations with backup
 */
export class SafeFileOperations {
  private backups: Map<string, string> = new Map()

  async writeWithBackup(path: string, content: string): Promise<void> {
    // Create backup if file exists
    if (await exists(path)) {
      const backup = await readFile(path)
      this.backups.set(path, backup)
    }

    // Write new content
    await writeFile(path, content)
  }

  async rollback(path: string): Promise<void> {
    const backup = this.backups.get(path)
    if (backup !== undefined) {
      await writeFile(path, backup)
      this.backups.delete(path)
    }
  }

  async rollbackAll(): Promise<void> {
    for (const [path, content] of this.backups) {
      await writeFile(path, content)
    }
    this.backups.clear()
  }

  clearBackups(): void {
    this.backups.clear()
  }
}

/**
 * Watch file for changes (simplified version)
 */
export async function watchFile(
  path: string,
  callback: (event: 'change' | 'delete') => void
): Promise<() => void> {
  const { watch } = await import('node:fs')
  const watcher = watch(path, (eventType, filename) => {
    if (eventType === 'change') {
      callback('change')
    } else if (eventType === 'rename') {
      // rename can mean delete
      exists(path).then(fileExists => {
        if (!fileExists) {
          callback('delete')
        }
      })
    }
  })

  return () => watcher.close()
}