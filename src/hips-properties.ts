import type { HiPSDataproductType, HiPSFrame, HiPSTileFormat } from './hips-types'

const REQUIRED_KEYS = [
  'creator_did',
  'obs_title',
  'dataproduct_type',
  'hips_version',
  'hips_frame',
  'hips_order',
  'hips_tile_width',
  'hips_tile_format',
] as const

const VALID_FRAMES = new Set<HiPSFrame>(['equatorial', 'galactic', 'ecliptic'])
const VALID_DATAPRODUCT_TYPES = new Set<HiPSDataproductType>(['image', 'cube'])
const VALID_FORMATS = new Set<HiPSTileFormat>(['fits', 'png', 'jpeg'])

export interface HiPSValidationReport {
  ok: boolean
  missing: string[]
  invalid: string[]
}

function normalizeValue(value: string): string {
  return value.trim()
}

export class HiPSProperties {
  private readonly data = new Map<string, string>()

  constructor(values?: Record<string, string>) {
    if (values) {
      for (const [key, value] of Object.entries(values)) {
        this.data.set(key.trim(), normalizeValue(value))
      }
    }
  }

  static parse(text: string): HiPSProperties {
    const values: Record<string, string> = {}
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      values[key] = value
    }
    return new HiPSProperties(values)
  }

  static fromObject(values: Record<string, string | number | boolean>): HiPSProperties {
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(values)) {
      normalized[key] = typeof value === 'string' ? value : String(value)
    }
    return new HiPSProperties(normalized)
  }

  get(key: string): string | undefined {
    return this.data.get(key)
  }

  set(key: string, value: string | number | boolean): this {
    this.data.set(key, typeof value === 'string' ? normalizeValue(value) : String(value))
    return this
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  delete(key: string): boolean {
    return this.data.delete(key)
  }

  keys(): string[] {
    return [...this.data.keys()]
  }

  toObject(): Record<string, string> {
    return Object.fromEntries(this.data.entries())
  }

  merge(values: Record<string, string | number | boolean>): this {
    for (const [key, value] of Object.entries(values)) {
      this.set(key, value)
    }
    return this
  }

  toString(): string {
    const entries = [...this.data.entries()].sort(([a], [b]) => a.localeCompare(b))
    return entries.map(([k, v]) => `${k.padEnd(20, ' ')} = ${v}`).join('\n') + '\n'
  }

  validate(): HiPSValidationReport {
    const missing = REQUIRED_KEYS.filter((key) => !this.data.has(key))
    const invalid: string[] = []

    const frame = this.get('hips_frame')
    if (frame && !VALID_FRAMES.has(frame as HiPSFrame)) {
      invalid.push(`hips_frame=${frame}`)
    }

    const dataproduct = this.get('dataproduct_type')
    if (dataproduct && !VALID_DATAPRODUCT_TYPES.has(dataproduct as HiPSDataproductType)) {
      invalid.push(`dataproduct_type=${dataproduct}`)
    }

    const formatValue = this.get('hips_tile_format')
    if (formatValue) {
      const formats = formatValue
        .split(/\s+/u)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
      if (
        formats.length === 0 ||
        formats.some((fmt) => !VALID_FORMATS.has(fmt as HiPSTileFormat))
      ) {
        invalid.push(`hips_tile_format=${formatValue}`)
      }
    }

    const orderValue = Number(this.get('hips_order'))
    if (this.has('hips_order') && (!Number.isInteger(orderValue) || orderValue < 0)) {
      invalid.push(`hips_order=${this.get('hips_order')}`)
    }

    const tileWidthValue = Number(this.get('hips_tile_width'))
    if (this.has('hips_tile_width') && (!Number.isInteger(tileWidthValue) || tileWidthValue <= 0)) {
      invalid.push(`hips_tile_width=${this.get('hips_tile_width')}`)
    }

    return {
      ok: missing.length === 0 && invalid.length === 0,
      missing: [...missing],
      invalid,
    }
  }

  withCompatibilityFields(): this {
    const frame = this.get('hips_frame')
    const order = this.get('hips_order')
    const format = this.get('hips_tile_format')
    if (frame) this.set('coordsys', frame)
    if (order) this.set('maxOrder', order)
    if (format) this.set('format', format)
    return this
  }
}

export function createDefaultHiPSProperties(params: {
  creatorDid: string
  obsTitle: string
  dataproductType?: HiPSDataproductType
  frame?: HiPSFrame
  order: number
  tileWidth: number
  formats: HiPSTileFormat[]
  version?: string
  extras?: Record<string, string | number | boolean>
}): HiPSProperties {
  const props = HiPSProperties.fromObject({
    creator_did: params.creatorDid,
    obs_title: params.obsTitle,
    dataproduct_type: params.dataproductType ?? 'image',
    hips_version: params.version ?? '1.4',
    hips_frame: params.frame ?? 'equatorial',
    hips_order: params.order,
    hips_tile_width: params.tileWidth,
    hips_tile_format: params.formats.join(' '),
  })
  if (params.extras) {
    props.merge(params.extras)
  }
  props.withCompatibilityFields()
  return props
}
