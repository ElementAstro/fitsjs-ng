import { zipSync } from 'fflate'
import { importNodeModule } from '../core/runtime'
import type { HiPSExportTarget } from './hips-types'

function toUint8Array(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+/u, '')
}

async function ensureNodeModules(): Promise<{
  fs: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
    writeFile(path: string, data: Uint8Array | string, encoding?: 'utf8'): Promise<void>
    readFile(path: string): Promise<Uint8Array>
    readFile(path: string, encoding: 'utf8'): Promise<string>
    access(path: string): Promise<void>
  }
  path: { join(...paths: string[]): string; dirname(path: string): string }
}> {
  const [fs, path] = await Promise.all([
    importNodeModule<{
      mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
      writeFile(path: string, data: Uint8Array | string, encoding?: 'utf8'): Promise<void>
      readFile(path: string): Promise<Uint8Array>
      readFile(path: string, encoding: 'utf8'): Promise<string>
      access(path: string): Promise<void>
    }>(
      'fs/promises',
      'NodeFSTarget filesystem access',
      'Use BrowserZipTarget or a custom HiPSExportTarget in browser/React Native.',
    ),
    importNodeModule<{ join(...paths: string[]): string; dirname(path: string): string }>(
      'path',
      'NodeFSTarget filesystem access',
      'Use BrowserZipTarget or a custom HiPSExportTarget in browser/React Native.',
    ),
  ])
  return { fs, path }
}

export class NodeFSTarget implements HiPSExportTarget {
  constructor(public readonly root: string) {}

  private async absolute(relativePath: string): Promise<string> {
    const { path } = await ensureNodeModules()
    return path.join(this.root, normalizePath(relativePath))
  }

  async writeBinary(path: string, data: Uint8Array | ArrayBuffer): Promise<void> {
    const { fs, path: pathApi } = await ensureNodeModules()
    const targetPath = await this.absolute(path)
    await fs.mkdir(pathApi.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, toUint8Array(data))
  }

  async writeText(path: string, text: string): Promise<void> {
    const { fs, path: pathApi } = await ensureNodeModules()
    const targetPath = await this.absolute(path)
    await fs.mkdir(pathApi.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, text, 'utf8')
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const { fs } = await ensureNodeModules()
    const targetPath = await this.absolute(path)
    const content = await fs.readFile(targetPath)
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
  }

  async readText(path: string): Promise<string> {
    const { fs } = await ensureNodeModules()
    const targetPath = await this.absolute(path)
    return fs.readFile(targetPath, 'utf8')
  }

  async exists(path: string): Promise<boolean> {
    const { fs } = await ensureNodeModules()
    try {
      await fs.access(await this.absolute(path))
      return true
    } catch {
      return false
    }
  }
}

export class BrowserZipTarget implements HiPSExportTarget {
  private readonly entries = new Map<string, Uint8Array>()

  async writeBinary(path: string, data: Uint8Array | ArrayBuffer): Promise<void> {
    this.entries.set(normalizePath(path), toUint8Array(data))
  }

  async writeText(path: string, text: string): Promise<void> {
    this.entries.set(normalizePath(path), new TextEncoder().encode(text))
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const content = this.entries.get(normalizePath(path))
    if (!content) {
      throw new Error(`Missing ZIP entry: ${path}`)
    }
    return content
  }

  async readText(path: string): Promise<string> {
    const data = await this.readBinary(path)
    return new TextDecoder().decode(data)
  }

  async exists(path: string): Promise<boolean> {
    return this.entries.has(normalizePath(path))
  }

  async finalize(): Promise<Blob | Uint8Array> {
    const files: Record<string, Uint8Array> = {}
    for (const [key, value] of this.entries.entries()) {
      files[key] = value
    }
    const zipped = zipSync(files, { level: 6 })
    if (typeof Blob !== 'undefined') {
      const blobPayload = new Uint8Array(zipped.byteLength)
      blobPayload.set(zipped)
      return new Blob([blobPayload.buffer], { type: 'application/zip' })
    }
    return zipped
  }
}

interface FileSystemDirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandleLike>
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<WritableStreamLike>
  getFile(): Promise<File>
}

interface WritableStreamLike {
  write(data: Uint8Array | string): Promise<void>
  close(): Promise<void>
}

function hasOPFS(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.storage?.getDirectory)
}

export class BrowserOPFSTarget implements HiPSExportTarget {
  private rootHandlePromise?: Promise<FileSystemDirectoryHandleLike>

  constructor(private readonly baseDir: string = 'fitsjs-hips') {}

  private async rootHandle(): Promise<FileSystemDirectoryHandleLike> {
    if (!hasOPFS()) {
      throw new Error('OPFS is not available in this environment')
    }
    if (!this.rootHandlePromise) {
      this.rootHandlePromise = (async () => {
        const root = await navigator.storage.getDirectory()
        return root.getDirectoryHandle(this.baseDir, {
          create: true,
        }) as Promise<FileSystemDirectoryHandleLike>
      })()
    }
    return this.rootHandlePromise
  }

  private async walk(
    path: string,
    create: boolean,
  ): Promise<{
    dir: FileSystemDirectoryHandleLike
    filename: string
  }> {
    const segments = normalizePath(path).split('/').filter(Boolean)
    if (segments.length === 0) {
      throw new Error('Path must not be empty')
    }
    const filename = segments.pop()!
    let dir = await this.rootHandle()
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create })
    }
    return { dir, filename }
  }

  async writeBinary(path: string, data: Uint8Array | ArrayBuffer): Promise<void> {
    const { dir, filename } = await this.walk(path, true)
    const fileHandle = await dir.getFileHandle(filename, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(toUint8Array(data))
    await writable.close()
  }

  async writeText(path: string, text: string): Promise<void> {
    const { dir, filename } = await this.walk(path, true)
    const fileHandle = await dir.getFileHandle(filename, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(text)
    await writable.close()
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const { dir, filename } = await this.walk(path, false)
    const fileHandle = await dir.getFileHandle(filename)
    const file = await fileHandle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  }

  async readText(path: string): Promise<string> {
    const bytes = await this.readBinary(path)
    return new TextDecoder().decode(bytes)
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.readBinary(path)
      return true
    } catch {
      return false
    }
  }
}
