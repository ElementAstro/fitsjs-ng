import { hipsAllskyPath, hipsTilePath } from './hips-path'
import { HiPSProperties } from './hips-properties'
import { decodeHiPSTile } from './hips-tile'
import { importNodeModule } from '../core/runtime'
import type {
  HiPSExportTarget,
  HiPSInput,
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

export class HiPS {
  private cachedProperties?: HiPSProperties
  private readonly source: HiPSInput

  constructor(source: HiPSInput) {
    this.source = source
  }

  static async open(source: HiPSInput): Promise<HiPS> {
    const hips = new HiPS(source)
    await hips.getProperties()
    return hips
  }

  private async readText(path: string): Promise<string> {
    if (typeof this.source === 'object' && this.source !== null) {
      if ('readText' in this.source && typeof this.source.readText === 'function') {
        return this.source.readText(path)
      }
      if ('root' in this.source) {
        const root = this.source.root
        if (isUrlLike(root)) {
          const response = await fetch(new URL(path, `${root.replace(/\/+$/u, '')}/`).toString())
          if (!response.ok) {
            throw new Error(`Failed to fetch ${path}: ${response.status}`)
          }
          return response.text()
        }
        const { fs, path: pathApi } = await ensureNodeModules()
        return fs.readFile(pathApi.join(root, path), 'utf8')
      }
    }

    if (typeof this.source === 'string') {
      if (isUrlLike(this.source)) {
        const response = await fetch(
          new URL(path, `${this.source.replace(/\/+$/u, '')}/`).toString(),
        )
        if (!response.ok) {
          throw new Error(`Failed to fetch ${path}: ${response.status}`)
        }
        return response.text()
      }
      const { fs, path: pathApi } = await ensureNodeModules()
      return fs.readFile(pathApi.join(this.source, path), 'utf8')
    }

    if (this.source instanceof URL) {
      const response = await fetch(
        new URL(path, `${this.source.toString().replace(/\/+$/u, '')}/`).toString(),
      )
      if (!response.ok) {
        throw new Error(`Failed to fetch ${path}: ${response.status}`)
      }
      return response.text()
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
          const response = await fetch(new URL(path, `${root.replace(/\/+$/u, '')}/`).toString())
          if (!response.ok) {
            throw new Error(`Failed to fetch ${path}: ${response.status}`)
          }
          return new Uint8Array(await response.arrayBuffer())
        }
        const { fs, path: pathApi } = await ensureNodeModules()
        const content = await fs.readFile(pathApi.join(root, path))
        return new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
      }
    }

    if (typeof this.source === 'string') {
      if (isUrlLike(this.source)) {
        const response = await fetch(
          new URL(path, `${this.source.replace(/\/+$/u, '')}/`).toString(),
        )
        if (!response.ok) {
          throw new Error(`Failed to fetch ${path}: ${response.status}`)
        }
        return new Uint8Array(await response.arrayBuffer())
      }
      const { fs, path: pathApi } = await ensureNodeModules()
      const content = await fs.readFile(pathApi.join(this.source, path))
      return new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
    }

    if (this.source instanceof URL) {
      const response = await fetch(
        new URL(path, `${this.source.toString().replace(/\/+$/u, '')}/`).toString(),
      )
      if (!response.ok) {
        throw new Error(`Failed to fetch ${path}: ${response.status}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    }

    throw new Error('Unsupported HiPS source for binary read')
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
        const bytes = await this.readBinary(hipsTilePath(tileMeta))
        return decodeHiPSTile(tileMeta, bytes)
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
        return await this.readBinary(hipsAllskyPath(fmt))
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(`Allsky not found: ${String(lastError)}`)
  }

  async exportProperties(target: HiPSExportTarget): Promise<void> {
    await target.writeText('properties', (await this.getProperties()).toString())
  }
}
