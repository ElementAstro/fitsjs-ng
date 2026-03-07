import { hipsAllskyPath, hipsTilePath } from './hips-path'
import { HiPSProperties } from './hips-properties'
import { decodeHiPSTile } from './hips-tile'
import { importNodeModule } from '../core/runtime'
import { fetchOkWithNetworkPolicy, normalizeNetworkReadOptions } from '../core/network'
import type {
  HiPSExportTarget,
  HiPSInput,
  HiPSReadOptions,
  HiPSReadTileResult,
  HiPSTileFormat,
  HiPSTileMeta,
} from './hips-types'

function isUrlLike(value: string): boolean {
  return /^https?:\/\//iu.test(value)
}

interface NodeFsLike {
  readFile(path: string): Promise<Uint8Array>
  readFile(path: string, encoding: 'utf8'): Promise<string>
}

interface NodePathLike {
  join(...paths: string[]): string
}

async function ensureNodeModules(): Promise<{
  fs: NodeFsLike
  path: NodePathLike
}> {
  const [fs, path] = await Promise.all([
    importNodeModule<NodeFsLike>(
      'fs/promises',
      'HiPS local-path access',
      'Use URL-based HiPS input or provide a custom HiPSExportTarget in browser/React Native.',
    ),
    importNodeModule<NodePathLike>(
      'path',
      'HiPS local-path access',
      'Use URL-based HiPS input or provide a custom HiPSExportTarget in browser/React Native.',
    ),
  ])
  return { fs, path }
}

interface NormalizedHiPSReadOptions {
  requestInit?: RequestInit
  timeoutMs?: number
  retryCount: number
  retryDelayMs: number
  tileCacheMaxEntries: number
  allskyCache: boolean
}

function normalizeHiPSReadOptions(options?: HiPSReadOptions): NormalizedHiPSReadOptions {
  const network = normalizeNetworkReadOptions(options)
  const tileCacheMaxEntries = options?.tileCacheMaxEntries ?? 0
  if (!Number.isInteger(tileCacheMaxEntries) || tileCacheMaxEntries < 0) {
    throw new Error('tileCacheMaxEntries must be a non-negative integer')
  }
  return {
    requestInit: network.requestInit,
    timeoutMs: network.timeoutMs,
    retryCount: network.retryCount,
    retryDelayMs: network.retryDelayMs,
    tileCacheMaxEntries,
    allskyCache: options?.allskyCache ?? false,
  }
}

export class HiPS {
  private cachedProperties?: HiPSProperties
  private readonly source: HiPSInput
  private readonly readOptions: NormalizedHiPSReadOptions
  private readonly tileReadCache = new Map<string, HiPSReadTileResult>()
  private readonly pendingTileReads = new Map<string, Promise<HiPSReadTileResult>>()
  private readonly allskyReadCache = new Map<string, Uint8Array>()
  private readonly pendingAllskyReads = new Map<string, Promise<Uint8Array>>()

  constructor(source: HiPSInput, options?: HiPSReadOptions) {
    this.source = source
    this.readOptions = normalizeHiPSReadOptions(options)
  }

  static async open(source: HiPSInput, options?: HiPSReadOptions): Promise<HiPS> {
    const hips = new HiPS(source, options)
    await hips.getProperties()
    return hips
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetchOkWithNetworkPolicy(
      url,
      {
        requestInit: this.readOptions.requestInit,
        timeoutMs: this.readOptions.timeoutMs,
        retryCount: this.readOptions.retryCount,
        retryDelayMs: this.readOptions.retryDelayMs,
      },
      { method: 'GET' },
      `Failed to fetch ${url}`,
    )
    return response.text()
  }

  private async fetchBinary(url: string): Promise<Uint8Array> {
    const response = await fetchOkWithNetworkPolicy(
      url,
      {
        requestInit: this.readOptions.requestInit,
        timeoutMs: this.readOptions.timeoutMs,
        retryCount: this.readOptions.retryCount,
        retryDelayMs: this.readOptions.retryDelayMs,
      },
      { method: 'GET' },
      `Failed to fetch ${url}`,
    )
    return new Uint8Array(await response.arrayBuffer())
  }

  private async readText(path: string): Promise<string> {
    if (typeof this.source === 'object' && this.source !== null) {
      if ('readText' in this.source && typeof this.source.readText === 'function') {
        return this.source.readText(path)
      }
      if ('root' in this.source) {
        const root = this.source.root
        if (isUrlLike(root)) {
          return this.fetchText(new URL(path, `${root.replace(/\/+$/u, '')}/`).toString())
        }
        const { fs, path: pathApi } = await ensureNodeModules()
        return fs.readFile(pathApi.join(root, path), 'utf8')
      }
    }

    if (typeof this.source === 'string') {
      if (isUrlLike(this.source)) {
        return this.fetchText(new URL(path, `${this.source.replace(/\/+$/u, '')}/`).toString())
      }
      const { fs, path: pathApi } = await ensureNodeModules()
      return fs.readFile(pathApi.join(this.source, path), 'utf8')
    }

    if (this.source instanceof URL) {
      return this.fetchText(
        new URL(path, `${this.source.toString().replace(/\/+$/u, '')}/`).toString(),
      )
    }

    throw new Error('Unsupported HiPS source for text read')
  }

  private async readBinary(path: string): Promise<Uint8Array> {
    if (typeof this.source === 'object' && this.source !== null) {
      if ('readBinary' in this.source && typeof this.source.readBinary === 'function') {
        return this.source.readBinary(path)
      }
      if ('root' in this.source) {
        const root = this.source.root
        if (isUrlLike(root)) {
          return this.fetchBinary(new URL(path, `${root.replace(/\/+$/u, '')}/`).toString())
        }
        const { fs, path: pathApi } = await ensureNodeModules()
        const content = await fs.readFile(pathApi.join(root, path))
        return new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
      }
    }

    if (typeof this.source === 'string') {
      if (isUrlLike(this.source)) {
        return this.fetchBinary(new URL(path, `${this.source.replace(/\/+$/u, '')}/`).toString())
      }
      const { fs, path: pathApi } = await ensureNodeModules()
      const content = await fs.readFile(pathApi.join(this.source, path))
      return new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
    }

    if (this.source instanceof URL) {
      return this.fetchBinary(
        new URL(path, `${this.source.toString().replace(/\/+$/u, '')}/`).toString(),
      )
    }

    throw new Error('Unsupported HiPS source for binary read')
  }

  private tileCacheKey(meta: HiPSTileMeta): string {
    const spectralOrder = meta.spectralOrder ?? ''
    const spectralIndex = meta.spectralIndex ?? ''
    return `${meta.frame}:${meta.format}:${meta.order}:${meta.ipix}:${spectralOrder}:${spectralIndex}`
  }

  private rememberTile(key: string, value: HiPSReadTileResult): void {
    if (this.readOptions.tileCacheMaxEntries <= 0) return
    if (this.tileReadCache.has(key)) {
      this.tileReadCache.delete(key)
    }
    this.tileReadCache.set(key, value)
    while (this.tileReadCache.size > this.readOptions.tileCacheMaxEntries) {
      const oldestKey = this.tileReadCache.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      this.tileReadCache.delete(oldestKey)
    }
  }

  private getCachedTile(key: string): HiPSReadTileResult | undefined {
    if (this.readOptions.tileCacheMaxEntries <= 0) return undefined
    const cached = this.tileReadCache.get(key)
    if (!cached) return undefined
    this.tileReadCache.delete(key)
    this.tileReadCache.set(key, cached)
    return cached
  }

  private async readTileByMeta(meta: HiPSTileMeta): Promise<HiPSReadTileResult> {
    const key = this.tileCacheKey(meta)
    const cached = this.getCachedTile(key)
    if (cached) {
      return cached
    }

    const pending = this.pendingTileReads.get(key)
    if (pending) {
      return pending
    }

    const promise = this.readBinary(hipsTilePath(meta))
      .then((bytes) => decodeHiPSTile(meta, bytes))
      .then((decoded) => {
        this.rememberTile(key, decoded)
        return decoded
      })
      .finally(() => {
        this.pendingTileReads.delete(key)
      })

    this.pendingTileReads.set(key, promise)
    return promise
  }

  private async readAllskyByFormat(format: HiPSTileFormat): Promise<Uint8Array> {
    const key = format
    if (this.readOptions.allskyCache) {
      const cached = this.allskyReadCache.get(key)
      if (cached) return cached
    }

    const pending = this.pendingAllskyReads.get(key)
    if (pending) {
      return pending
    }

    const promise = this.readBinary(hipsAllskyPath(format))
      .then((bytes) => {
        if (this.readOptions.allskyCache) {
          this.allskyReadCache.set(key, bytes)
        }
        return bytes
      })
      .finally(() => {
        this.pendingAllskyReads.delete(key)
      })

    this.pendingAllskyReads.set(key, promise)
    return promise
  }

  async getProperties(): Promise<HiPSProperties> {
    if (!this.cachedProperties) {
      const propertiesPath =
        typeof this.source === 'object' && this.source !== null && 'propertiesPath' in this.source
          ? (this.source.propertiesPath ?? 'properties')
          : 'properties'
      const text = await this.readText(propertiesPath)
      this.cachedProperties = HiPSProperties.parse(text)
    }
    return this.cachedProperties
  }

  async tileFormats(): Promise<HiPSTileFormat[]> {
    const props = await this.getProperties()
    const value = props.get('hips_tile_format') ?? 'fits'
    const formats = value
      .split(/\s+/u)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    const out: HiPSTileFormat[] = []
    for (const format of formats) {
      if (format === 'fits' || format === 'png' || format === 'jpeg' || format === 'jpg') {
        out.push(format === 'jpg' ? 'jpeg' : (format as HiPSTileFormat))
      }
    }
    return out.length > 0 ? out : ['fits']
  }

  async readTile(
    meta: Omit<HiPSTileMeta, 'frame' | 'format'> & {
      frame?: HiPSTileMeta['frame']
      format?: HiPSTileFormat
    },
  ): Promise<HiPSReadTileResult> {
    const props = await this.getProperties()
    const frame = meta.frame ?? (props.get('hips_frame') as HiPSTileMeta['frame']) ?? 'equatorial'

    const preferredFormats: HiPSTileFormat[] = meta.format
      ? [meta.format]
      : await this.tileFormats()

    let lastError: unknown
    for (const format of preferredFormats) {
      try {
        const tileMeta: HiPSTileMeta = { ...meta, frame, format }
        return await this.readTileByMeta(tileMeta)
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(
      `Unable to read HiPS tile order=${meta.order} ipix=${meta.ipix}: ${String(lastError)}`,
    )
  }

  async readAllsky(format?: HiPSTileFormat): Promise<Uint8Array> {
    const formats = format ? [format] : await this.tileFormats()
    let lastError: unknown
    for (const fmt of formats) {
      try {
        return await this.readAllskyByFormat(fmt)
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(`Allsky not found: ${String(lastError)}`)
  }

  clearReadCache(kind: 'tile' | 'allsky' | 'properties' | 'all' = 'all'): void {
    if (kind === 'tile' || kind === 'all') {
      this.tileReadCache.clear()
      this.pendingTileReads.clear()
    }
    if (kind === 'allsky' || kind === 'all') {
      this.allskyReadCache.clear()
      this.pendingAllskyReads.clear()
    }
    if (kind === 'properties' || kind === 'all') {
      this.cachedProperties = undefined
    }
  }

  async exportProperties(target: HiPSExportTarget): Promise<void> {
    await target.writeText('properties', (await this.getProperties()).toString())
  }
}
