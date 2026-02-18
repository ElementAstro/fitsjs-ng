import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BrowserOPFSTarget, BrowserZipTarget, NodeFSTarget } from '../src/storage-target'

describe('storage-target', () => {
  it('writes and reads files on Node FS target', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-hips-'))
    try {
      const target = new NodeFSTarget(dir)
      await target.writeText('properties', 'hips_version = 1.4\n')
      await target.writeBinary('Norder0/Dir0/Npix0.fits', new Uint8Array([1, 2, 3]))

      expect(await target.exists('properties')).toBe(true)
      expect(await target.readText('properties')).toContain('hips_version')
      expect(Array.from(await target.readBinary('Norder0/Dir0/Npix0.fits'))).toEqual([1, 2, 3])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('builds zip archive entries in browser zip target', async () => {
    const target = new BrowserZipTarget()
    await target.writeText('properties', 'hips_version = 1.4\n')
    await target.writeBinary('Norder0/Dir0/Npix0.fits', new Uint8Array([1, 2, 3]))

    const blobOrBytes = await target.finalize()
    if (blobOrBytes instanceof Blob) {
      expect(blobOrBytes.size).toBeGreaterThan(20)
    } else {
      expect(blobOrBytes.byteLength).toBeGreaterThan(20)
    }
  })

  it('reads zip entries and throws on missing paths', async () => {
    const target = new BrowserZipTarget()
    await target.writeText('\\nested\\path\\a.txt', 'hello')
    expect(await target.exists('nested/path/a.txt')).toBe(true)
    expect(await target.readText('nested/path/a.txt')).toBe('hello')
    await expect(target.readBinary('missing.bin')).rejects.toThrow('Missing ZIP entry')
  })

  it('handles OPFS unavailable and empty path validation', async () => {
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true })
    try {
      const target = new BrowserOPFSTarget()
      await expect(target.exists('x')).resolves.toBe(false)
    } finally {
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
      } else {
        delete (globalThis as { navigator?: unknown }).navigator
      }
    }

    class FileHandle {
      data = new Uint8Array(0)
      async createWritable() {
        return {
          write: async (payload: Uint8Array | string) => {
            this.data = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload
          },
          close: async () => {},
        }
      }
      async getFile() {
        const data = this.data
        return {
          async arrayBuffer() {
            const copy = new Uint8Array(data.byteLength)
            copy.set(data)
            return copy.buffer
          },
        } as File
      }
    }
    class DirHandle {
      dirs = new Map<string, DirHandle>()
      files = new Map<string, FileHandle>()
      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const existing = this.dirs.get(name)
        if (existing) return existing
        if (!options?.create) throw new Error(`dir not found: ${name}`)
        const created = new DirHandle()
        this.dirs.set(name, created)
        return created
      }
      async getFileHandle(name: string, options?: { create?: boolean }) {
        const existing = this.files.get(name)
        if (existing) return existing
        if (!options?.create) throw new Error(`file not found: ${name}`)
        const created = new FileHandle()
        this.files.set(name, created)
        return created
      }
    }

    const root = new DirHandle()
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          async getDirectory() {
            return root
          },
        },
      },
      configurable: true,
    })
    try {
      const target = new BrowserOPFSTarget('fitsjs-tests')
      await expect(target.writeText('/', 'x')).rejects.toThrow('Path must not be empty')
      await target.writeText('a/b/c.txt', 'abc')
      await target.writeBinary('a/b/data.bin', new Uint8Array([4, 5, 6]))
      expect(await target.readText('a/b/c.txt')).toBe('abc')
      expect(Array.from(await target.readBinary('a/b/data.bin'))).toEqual([4, 5, 6])
      expect(await target.exists('a/b/data.bin')).toBe(true)
      expect(await target.exists('a/b/missing.bin')).toBe(false)
    } finally {
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
      } else {
        delete (globalThis as { navigator?: unknown }).navigator
      }
    }
  })
})
