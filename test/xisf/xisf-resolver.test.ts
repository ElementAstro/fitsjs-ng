import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { XISFResourceError } from '../../src/xisf/xisf-errors'
import { DefaultXISFResourceResolver } from '../../src/xisf/xisf-resolver'

describe('xisf-resolver', () => {
  it('resolves URL resources and rejects non-2xx responses', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/ok')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      }
      return new Response('nope', { status: 404, statusText: 'Not Found' })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const bytes = await DefaultXISFResourceResolver.resolveURL('https://example.test/ok')
      expect(Array.from(bytes)).toEqual([1, 2, 3])
      await expect(
        DefaultXISFResourceResolver.resolveURL('https://example.test/miss'),
      ).rejects.toBeInstanceOf(XISFResourceError)
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('reads path resources with node fs in node environments', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fitsjs-xisf-resolver-'))
    const file = join(dir, 'payload.bin')
    try {
      await writeFile(file, new Uint8Array([9, 8, 7]))
      const out = await DefaultXISFResourceResolver.resolvePath(file)
      expect(Array.from(out)).toEqual([9, 8, 7])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects path-based resolution in non-node runtimes', async () => {
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', {
      value: { product: 'ReactNative' },
      configurable: true,
    })
    try {
      await expect(DefaultXISFResourceResolver.resolvePath('/tmp/x')).rejects.toThrow(
        'custom resourceResolver.resolvePath',
      )
    } finally {
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
      } else {
        delete (globalThis as { navigator?: unknown }).navigator
      }
    }
  })

  it('wraps node filesystem read errors with XISFResourceError', async () => {
    await expect(
      DefaultXISFResourceResolver.resolvePath(join(tmpdir(), 'missing-no-such-file.xisf')),
    ).rejects.toBeInstanceOf(XISFResourceError)
  })
})
