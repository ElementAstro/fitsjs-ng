import { BLOCK_LENGTH, LINE_WIDTH } from '../core/constants'

export interface FITSHeaderCard {
  key: string
  value?: string | number | boolean | bigint | null
  comment?: string
}

export interface FITSWriteHDU {
  cards: FITSHeaderCard[]
  data?: Uint8Array
}

function padCard(text: string): string {
  return text.padEnd(LINE_WIDTH, ' ').slice(0, LINE_WIDTH)
}

function formatValue(value: string | number | boolean | bigint | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const escaped = value.replaceAll("'", "''")
    return `'${escaped}'`
  }
  if (typeof value === 'boolean') {
    return value ? 'T' : 'F'
  }
  if (typeof value === 'bigint') {
    return value.toString(10)
  }
  if (Number.isFinite(value)) {
    return Number.isInteger(value) ? value.toString(10) : value.toExponential().replace('e', 'E')
  }
  return String(value)
}

function formatCard(card: FITSHeaderCard): string {
  const key = card.key.toUpperCase().slice(0, 8).padEnd(8, ' ')
  if (card.key === 'END') return padCard('END')
  if (card.value === undefined) {
    return padCard(`${key}  ${card.comment ?? ''}`)
  }

  const valueText = formatValue(card.value)
  const body = `${key}= ${valueText}`
  if (card.comment) {
    return padCard(`${body} / ${card.comment}`)
  }
  return padCard(body)
}

function padBlockLength(length: number): number {
  return length + ((BLOCK_LENGTH - (length % BLOCK_LENGTH)) % BLOCK_LENGTH)
}

function buildHeader(cards: FITSHeaderCard[]): Uint8Array {
  const withEnd = [...cards]
  if (!withEnd.some((c) => c.key === 'END')) {
    withEnd.push({ key: 'END' })
  }
  const header = withEnd.map(formatCard).join('')
  const padded = header.padEnd(padBlockLength(header.length), ' ')
  return new TextEncoder().encode(padded)
}

export function writeFITS(hdus: FITSWriteHDU[]): ArrayBuffer {
  const headerBlocks = hdus.map((hdu) => buildHeader(hdu.cards))
  const dataBlocks = hdus.map((hdu) => {
    const data = hdu.data ?? new Uint8Array(0)
    const paddedLength = padBlockLength(data.byteLength)
    const out = new Uint8Array(paddedLength)
    out.set(data)
    return out
  })

  const total =
    headerBlocks.reduce((sum, h) => sum + h.byteLength, 0) +
    dataBlocks.reduce((sum, d) => sum + d.byteLength, 0)

  const out = new Uint8Array(total)
  let offset = 0
  for (let i = 0; i < hdus.length; i++) {
    const header = headerBlocks[i]!
    const data = dataBlocks[i]!
    out.set(header, offset)
    offset += header.byteLength
    out.set(data, offset)
    offset += data.byteLength
  }

  return out.buffer
}

export function createImageBytesFromArray(
  values: ArrayLike<number> | ArrayLike<bigint>,
  bitpix: 8 | 16 | 32 | 64 | -32 | -64,
): Uint8Array {
  const bytesPerSample = Math.abs(bitpix) / 8
  const out = new Uint8Array(values.length * bytesPerSample)
  const view = new DataView(out.buffer)

  for (let i = 0; i < values.length; i++) {
    const value = values[i]!
    const pos = i * bytesPerSample
    switch (bitpix) {
      case 8:
        view.setUint8(pos, Number(value))
        break
      case 16:
        view.setInt16(pos, Number(value), false)
        break
      case 32:
        view.setInt32(pos, Number(value), false)
        break
      case 64:
        view.setBigInt64(pos, BigInt(value as bigint | number), false)
        break
      case -32:
        view.setFloat32(pos, Number(value), false)
        break
      case -64:
        view.setFloat64(pos, Number(value), false)
        break
    }
  }

  return out
}

export function createImageHDU(params: {
  primary?: boolean
  extensionType?: 'IMAGE'
  width: number
  height: number
  depth?: number
  bitpix: 8 | 16 | 32 | 64 | -32 | -64
  data: Uint8Array
  bzero?: number | bigint
  bscale?: number
  extname?: string
  additionalCards?: FITSHeaderCard[]
}): FITSWriteHDU {
  const naxis = params.depth && params.depth > 1 ? 3 : 2
  const cards: FITSHeaderCard[] = []

  if (params.primary !== false) {
    cards.push({ key: 'SIMPLE', value: true, comment: 'Standard FITS' })
  } else {
    cards.push({
      key: 'XTENSION',
      value: params.extensionType ?? 'IMAGE',
      comment: 'Image extension',
    })
  }

  cards.push({ key: 'BITPIX', value: params.bitpix, comment: 'Bits per pixel' })
  cards.push({ key: 'NAXIS', value: naxis, comment: 'Number of axes' })
  cards.push({ key: 'NAXIS1', value: params.width })
  cards.push({ key: 'NAXIS2', value: params.height })
  if (naxis === 3) cards.push({ key: 'NAXIS3', value: params.depth ?? 1 })
  if (params.primary !== false) {
    cards.push({ key: 'EXTEND', value: true })
  } else {
    cards.push({ key: 'PCOUNT', value: 0 })
    cards.push({ key: 'GCOUNT', value: 1 })
  }
  if (params.bscale !== undefined) cards.push({ key: 'BSCALE', value: params.bscale })
  if (params.bzero !== undefined) cards.push({ key: 'BZERO', value: params.bzero })
  if (params.extname) cards.push({ key: 'EXTNAME', value: params.extname })
  if (params.additionalCards) cards.push(...params.additionalCards)

  return {
    cards,
    data: params.data,
  }
}
