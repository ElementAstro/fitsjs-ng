import type { XISFLocation } from './xisf-types'
import { XISFParseError, XISFValidationError } from './xisf-errors'

const URL_OR_PATH = /^(url|path)\((.*)\)(?::(.*))?$/

function parseIndexId(raw: string | undefined): bigint | undefined {
  if (!raw) return undefined
  const value = raw.trim()
  if (value.length === 0) return undefined
  if (value.startsWith('0x') || value.startsWith('0X')) return BigInt(value)
  return BigInt(value)
}

export function parseXISFLocation(location: string): XISFLocation {
  const trimmed = location.trim()

  if (trimmed.startsWith('inline:')) {
    const encoding = trimmed.slice('inline:'.length)
    if (encoding !== 'base64' && encoding !== 'hex') {
      throw new XISFParseError(`Unsupported inline encoding: ${encoding}`)
    }
    return { type: 'inline', encoding }
  }

  if (trimmed === 'embedded') {
    return { type: 'embedded' }
  }

  if (trimmed.startsWith('attachment:') || trimmed.startsWith('attached:')) {
    const canonical = trimmed.startsWith('attached:')
      ? `attachment:${trimmed.slice('attached:'.length)}`
      : trimmed
    const parts = canonical.split(':')
    if (parts.length !== 3) {
      throw new XISFParseError(`Invalid attachment location: ${location}`)
    }
    const position = Number(parts[1])
    const size = Number(parts[2])
    if (!Number.isInteger(position) || !Number.isInteger(size) || position < 0 || size < 0) {
      throw new XISFParseError(`Invalid attachment numbers: ${location}`)
    }
    return { type: 'attachment', position, size }
  }

  const match = URL_OR_PATH.exec(trimmed)
  if (match) {
    const kind = match[1]!
    const spec = match[2]!
    const indexId = parseIndexId(match[3])
    if (kind === 'url') {
      return { type: 'url', url: spec, indexId }
    }
    return { type: 'path', path: spec, indexId }
  }

  throw new XISFParseError(`Unsupported location syntax: ${location}`)
}

export function parseCompressionSubblocks(
  value: string,
): Array<{ compressedSize: number; uncompressedSize: number }> {
  if (!value.trim()) return []
  return value.split(':').map((entry) => {
    const parts = entry.split(',')
    if (parts.length !== 2) {
      throw new XISFParseError(`Invalid subblocks entry: ${entry}`)
    }
    const compressedSize = Number(parts[0])
    const uncompressedSize = Number(parts[1])
    if (
      !Number.isInteger(compressedSize) ||
      !Number.isInteger(uncompressedSize) ||
      compressedSize < 0 ||
      uncompressedSize < 0
    ) {
      throw new XISFParseError(`Invalid subblocks values: ${entry}`)
    }
    return { compressedSize, uncompressedSize }
  })
}

export function parseChecksumSpec(value: string): { algorithm: string; digest: string } {
  const idx = value.indexOf(':')
  if (idx <= 0) {
    throw new XISFParseError(`Invalid checksum format: ${value}`)
  }
  return {
    algorithm: value.slice(0, idx).toLowerCase(),
    digest: value.slice(idx + 1).toLowerCase(),
  }
}

export function parseCompressionSpec(value: string): {
  codec: string
  uncompressedSize: number
  itemSize?: number
} {
  const parts = value.split(':')
  if (parts.length < 2 || parts.length > 3) {
    throw new XISFParseError(`Invalid compression format: ${value}`)
  }
  const codec = parts[0]!.toLowerCase()
  const uncompressedSize = Number(parts[1])
  if (!Number.isInteger(uncompressedSize) || uncompressedSize < 0) {
    throw new XISFParseError(`Invalid uncompressed size: ${value}`)
  }
  if (parts.length === 3) {
    const itemSize = Number(parts[2])
    if (!Number.isInteger(itemSize) || itemSize <= 0) {
      throw new XISFParseError(`Invalid shuffle item size: ${value}`)
    }
    return { codec, uncompressedSize, itemSize }
  }
  return { codec, uncompressedSize }
}

export function resolveHeaderRelativePath(pathSpec: string, headerDir?: string): string {
  if (pathSpec.startsWith('@header_dir/')) {
    if (!headerDir) {
      throw new XISFValidationError('Path uses @header_dir but no headerDir was provided')
    }
    const rel = pathSpec.slice('@header_dir/'.length)
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(headerDir)) {
      return new URL(rel, `${headerDir.replace(/\/?$/, '/')}`).toString()
    }
    return `${headerDir.replace(/\\/g, '/').replace(/\/$/, '')}/${rel}`
  }
  return pathSpec
}
