import { FITS } from './fits'
import { BinaryTable } from './binary-table'
import { Image } from './image'
import { XISF } from './xisf'
import { XISFWriter } from './xisf-writer'
import {
  createImageBytesFromArray,
  createImageHDU,
  writeFITS,
  type FITSWriteHDU,
} from './fits-writer'
import { XISFConversionError } from './xisf-errors'
import type { ConversionOptions, XISFImage, XISFUnit, XISFWriteOptions } from './xisf-types'

const U16_BZERO = 32768
const U32_BZERO = 2147483648
const U64_BZERO = 9223372036854775808n
const FITS_PRESERVED_LAYOUT_PROPERTY = 'FITS:PreservedHDULayout'

interface PreservedCard {
  key: string
  value?: string | number | boolean | null
  comment?: string
}

interface PreservedHDU {
  index: number
  cards: PreservedCard[]
  dataBase64: string
}

interface PreservedHDULayout {
  imageSourceIndices: number[]
  nonImageHDUs: PreservedHDU[]
}

function product(values: number[]): number {
  return values.reduce((a, b) => a * b, 1)
}

function readViewValue(
  view: DataView,
  offset: number,
  format: XISFImage['sampleFormat'],
  little: boolean,
): number | bigint {
  switch (format) {
    case 'UInt8':
      return view.getUint8(offset)
    case 'UInt16':
      return view.getUint16(offset, little)
    case 'UInt32':
      return view.getUint32(offset, little)
    case 'UInt64':
      return view.getBigUint64(offset, little)
    case 'Float32':
      return view.getFloat32(offset, little)
    case 'Float64':
      return view.getFloat64(offset, little)
    default:
      return view.getFloat32(offset, little)
  }
}

function sampleSize(format: XISFImage['sampleFormat']): number {
  switch (format) {
    case 'UInt8':
      return 1
    case 'UInt16':
      return 2
    case 'UInt32':
    case 'Float32':
      return 4
    case 'UInt64':
    case 'Float64':
      return 8
    case 'Complex32':
      return 8
    case 'Complex64':
      return 16
  }
}

function decodeXISFImageValues(image: XISFImage): Array<number | bigint> {
  if (!image.data) {
    throw new XISFConversionError('XISF image data was not decoded')
  }

  const size = sampleSize(image.sampleFormat)
  const view = new DataView(image.data.buffer, image.data.byteOffset, image.data.byteLength)
  const count = image.data.byteLength / size
  const little = image.dataBlock.byteOrder !== 'big'

  if (image.sampleFormat === 'Complex32' || image.sampleFormat === 'Complex64') {
    const scalarFormat = image.sampleFormat === 'Complex32' ? 'Float32' : 'Float64'
    const scalarSize = sampleSize(scalarFormat)
    const out: number[] = new Array((count * size) / scalarSize)
    let oi = 0
    for (let i = 0; i < count; i++) {
      const base = i * size
      out[oi++] = Number(readViewValue(view, base, scalarFormat, little))
      out[oi++] = Number(readViewValue(view, base + scalarSize, scalarFormat, little))
    }
    return out
  }

  const out: Array<number | bigint> = new Array(count)
  for (let i = 0; i < count; i++) {
    out[i] = readViewValue(view, i * size, image.sampleFormat, little)
  }

  if (image.pixelStorage === 'Normal' && image.channelCount > 1) {
    const pixels = count / image.channelCount
    const deinterleaved: Array<number | bigint> = new Array(count)
    let di = 0
    for (let c = 0; c < image.channelCount; c++) {
      for (let p = 0; p < pixels; p++) {
        deinterleaved[di++] = out[p * image.channelCount + c]!
      }
    }
    return deinterleaved
  }

  return out
}

function encodeLittleEndian(
  values: ArrayLike<number | bigint>,
  format: XISFImage['sampleFormat'],
): Uint8Array {
  const size = sampleSize(format)
  const out = new Uint8Array(values.length * size)
  const view = new DataView(out.buffer)

  for (let i = 0; i < values.length; i++) {
    const value = values[i]!
    const offset = i * size
    switch (format) {
      case 'UInt8':
        view.setUint8(offset, Number(value))
        break
      case 'UInt16':
        view.setUint16(offset, Number(value), true)
        break
      case 'UInt32':
        view.setUint32(offset, Number(value), true)
        break
      case 'UInt64':
        view.setBigUint64(offset, BigInt(value), true)
        break
      case 'Float32':
        view.setFloat32(offset, Number(value), true)
        break
      case 'Float64':
        view.setFloat64(offset, Number(value), true)
        break
      case 'Complex32':
      case 'Complex64':
        break
    }
  }

  return out
}

function encodeComplexLittleEndian(
  values: ArrayLike<number>,
  format: 'Complex32' | 'Complex64',
): Uint8Array {
  const bytesPerComponent = format === 'Complex32' ? 4 : 8
  const out = new Uint8Array(values.length * bytesPerComponent)
  const view = new DataView(out.buffer)
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!
    const offset = i * bytesPerComponent
    if (format === 'Complex32') {
      view.setFloat32(offset, value, true)
    } else {
      view.setFloat64(offset, value, true)
    }
  }
  return out
}

function normalizeInputToArrayBuffer(
  input: ArrayBuffer | Blob,
): Promise<ArrayBuffer> | ArrayBuffer {
  if (input instanceof ArrayBuffer) return input
  return input.arrayBuffer()
}

async function encodeBase64(bytes: Uint8Array): Promise<string> {
  if (typeof btoa === 'function') {
    let bin = ''
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]!)
    }
    return btoa(bin)
  }
  const mod = (await import('node:buffer')) as {
    Buffer: { from(input: Uint8Array): { toString(encoding: 'base64'): string } }
  }
  return mod.Buffer.from(bytes).toString('base64')
}

async function decodeBase64(payload: string): Promise<Uint8Array> {
  if (typeof atob === 'function') {
    const normalized = payload.replace(/\s+/g, '')
    const bin = atob(normalized)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  const mod = (await import('node:buffer')) as {
    Buffer: { from(input: string, encoding: 'base64'): Uint8Array }
  }
  return new Uint8Array(mod.Buffer.from(payload, 'base64'))
}

function buildXISFMetaJSON(xisf: XISF): string {
  return JSON.stringify(
    {
      metadata: xisf.unit.metadata,
      standaloneProperties: xisf.unit.standaloneProperties,
      standaloneTables: xisf.unit.standaloneTables,
    },
    null,
    0,
  )
}

function geometryFromImage(image: XISFImage): { width: number; height: number; depth: number } {
  if (image.geometry.length === 1) {
    return { width: image.geometry[0]!, height: 1, depth: image.channelCount }
  }
  if (image.geometry.length === 2) {
    return { width: image.geometry[0]!, height: image.geometry[1]!, depth: image.channelCount }
  }
  const width = image.geometry[0]!
  const height = image.geometry[1]!
  const extraDepth = product(image.geometry.slice(2))
  return { width, height, depth: image.channelCount * extraDepth }
}

function isStrict(options?: ConversionOptions): boolean {
  return options?.strictValidation ?? options?.relaxed !== true
}

function isHeaderTrue(fits: FITS['hdus'][number]['header'], key: string): boolean {
  const value = fits.get(key)
  return value === true || value === 'T' || value === 'true' || value === 1
}

function parseHeaderValuePortion(rawValue: string): string {
  if (rawValue.trimStart().startsWith("'")) {
    const openQuote = rawValue.indexOf("'")
    let closeQuote = -1
    let pos = openQuote + 1
    while (pos < rawValue.length) {
      const q = rawValue.indexOf("'", pos)
      if (q === -1) break
      if (q + 1 < rawValue.length && rawValue[q + 1] === "'") {
        pos = q + 2
        continue
      }
      closeQuote = q
      break
    }
    if (closeQuote === -1) return rawValue.trim()
    return rawValue.slice(0, closeQuote + 1).trim()
  }
  const slashIdx = rawValue.indexOf(' /')
  return (slashIdx === -1 ? rawValue : rawValue.slice(0, slashIdx)).trim()
}

function getRawHeaderValue(header: FITS['hdus'][number]['header'], key: string): string | null {
  const lineWidth = 80
  const block = header.block
  for (let i = 0; i + lineWidth <= block.length; i += lineWidth) {
    const line = block.slice(i, i + lineWidth)
    const cardKey = line.slice(0, 8).trim()
    if (cardKey !== key) continue
    if (line.slice(8, 10) !== '= ') return null
    return parseHeaderValuePortion(line.slice(10))
  }
  return null
}

function parseStrictIntegerLiteral(raw: string | null): bigint | null {
  if (!raw) return null
  const normalized = raw.trim()
  if (!/^[-+]?\d+$/u.test(normalized)) return null
  try {
    return BigInt(normalized)
  } catch {
    return null
  }
}

function isCanonicalUInt64BITPIX64(header: FITS['hdus'][number]['header'], image: Image): boolean {
  if (image.bitpix !== 64) return false
  const bscaleRaw = getRawHeaderValue(header, 'BSCALE')
  const bzeroRaw = getRawHeaderValue(header, 'BZERO')
  const bscale = bscaleRaw ? Number(bscaleRaw) : 1
  if (bscale !== 1) return false
  const bzero = parseStrictIntegerLiteral(bzeroRaw)
  return bzero === U64_BZERO
}

function formatFITSKeywordValue(value: unknown): string {
  if (value === true) return 'T'
  if (value === false) return 'F'
  if (value === null || value === undefined) return ''
  return String(value)
}

function upsertMetadataString(
  metadata: XISFUnit['metadata'],
  id: string,
  value: string,
): XISFUnit['metadata'] {
  const out = metadata.filter((property) => property.id !== id)
  out.push({
    id,
    type: 'String',
    value,
  })
  return out
}

function readPreservedLayoutFromMetadata(
  metadata: XISFUnit['metadata'],
): PreservedHDULayout | null {
  const property = metadata.find((item) => item.id === FITS_PRESERVED_LAYOUT_PROPERTY)
  if (!property || typeof property.value !== 'string') return null
  try {
    const parsed = JSON.parse(property.value) as PreservedHDULayout
    if (!Array.isArray(parsed.imageSourceIndices) || !Array.isArray(parsed.nonImageHDUs))
      return null
    return parsed
  } catch {
    return null
  }
}

function toFITSWriteHDU(preserved: PreservedHDU, data: Uint8Array): FITSWriteHDU {
  return {
    cards: preserved.cards.map((card) => ({
      key: card.key,
      value: card.value,
      comment: card.comment,
    })),
    data,
  }
}

async function toPreservedHDU(hdu: FITS['hdus'][number], index: number): Promise<PreservedHDU> {
  const cards = hdu.header.getCards().map((card) => ({
    key: card.key,
    value: typeof card.value === 'bigint' ? Number(card.value) : card.value,
    comment: card.comment || undefined,
  }))

  let bytes = new Uint8Array(0)
  if (hdu.data?.buffer) {
    bytes = new Uint8Array(hdu.data.buffer)
  } else if (hdu.data?.blob) {
    bytes = new Uint8Array(await hdu.data.blob.arrayBuffer())
  }

  return {
    index,
    cards,
    dataBase64: await encodeBase64(bytes),
  }
}

export async function convertXisfToFits(
  input: ArrayBuffer | Blob | XISF,
  options?: ConversionOptions,
): Promise<ArrayBuffer> {
  const strictValidation = isStrict(options)
  const xisf =
    input instanceof XISF
      ? input
      : await XISF.fromArrayBuffer(await normalizeInputToArrayBuffer(input), {
          strictValidation,
        })

  const imageHDUs: FITSWriteHDU[] = []

  for (let i = 0; i < xisf.unit.images.length; i++) {
    const image = xisf.unit.images[i]!
    const values = decodeXISFImageValues(image)
    const { width, height, depth } = geometryFromImage(image)
    const additionalCards = image.fitsKeywords.map((kw) => ({
      key: kw.name,
      value: kw.value,
      comment: kw.comment,
    }))

    if (image.sampleFormat === 'Complex32' || image.sampleFormat === 'Complex64') {
      const data = createImageBytesFromArray(
        values as ArrayLike<number>,
        image.sampleFormat === 'Complex32' ? -32 : -64,
      )
      const rowSize = image.sampleFormat === 'Complex32' ? 8 : 16
      const rowCount = width * height * depth
      imageHDUs.push({
        cards: [
          { key: 'XTENSION', value: 'BINTABLE', comment: 'Binary table extension' },
          { key: 'BITPIX', value: 8, comment: '8-bit bytes' },
          { key: 'NAXIS', value: 2, comment: 'Table axes' },
          { key: 'NAXIS1', value: rowSize, comment: 'Bytes per row' },
          { key: 'NAXIS2', value: rowCount, comment: 'Rows' },
          { key: 'PCOUNT', value: 0 },
          { key: 'GCOUNT', value: 1 },
          { key: 'TFIELDS', value: 1 },
          { key: 'TTYPE1', value: 'XISFCPLX' },
          { key: 'TFORM1', value: image.sampleFormat === 'Complex32' ? '1C' : '1M' },
          { key: 'EXTNAME', value: i === 0 ? 'XISF_COMPLEX' : `XISF_COMPLEX_${i}` },
          { key: 'XISFCPLX', value: true },
          { key: 'XISFSFMT', value: image.sampleFormat },
          { key: 'XISFWID', value: width },
          { key: 'XISFHEI', value: height },
          { key: 'XISFDEP', value: depth },
          { key: 'XISFCHN', value: image.channelCount },
          ...additionalCards,
        ],
        data,
      })
      continue
    }

    let bitpix: 8 | 16 | 32 | 64 | -32 | -64
    let bzero: number | bigint | undefined
    let data: Uint8Array

    switch (image.sampleFormat) {
      case 'UInt8':
        bitpix = 8
        data = createImageBytesFromArray(values as ArrayLike<number>, 8)
        break
      case 'UInt16': {
        bitpix = 16
        bzero = U16_BZERO
        const raw = Array.from(values as ArrayLike<number>, (v) => Number(v) - U16_BZERO)
        data = createImageBytesFromArray(raw, 16)
        break
      }
      case 'UInt32': {
        bitpix = 32
        bzero = U32_BZERO
        const raw = Array.from(values as ArrayLike<number>, (v) => Number(v) - U32_BZERO)
        data = createImageBytesFromArray(raw, 32)
        break
      }
      case 'UInt64': {
        bitpix = 64
        bzero = U64_BZERO
        const raw = Array.from(values as ArrayLike<bigint>, (v) => BigInt(v) - U64_BZERO)
        data = createImageBytesFromArray(raw, 64)
        break
      }
      case 'Float32':
        bitpix = -32
        data = createImageBytesFromArray(values as ArrayLike<number>, -32)
        break
      case 'Float64':
        bitpix = -64
        data = createImageBytesFromArray(values as ArrayLike<number>, -64)
        break
      default:
        throw new XISFConversionError(`Unsupported sample format: ${image.sampleFormat}`)
    }

    imageHDUs.push(
      createImageHDU({
        primary: i === 0,
        extensionType: 'IMAGE',
        width,
        height,
        depth,
        bitpix,
        data,
        bzero,
        bscale: 1,
        extname: i === 0 ? undefined : (image.id ?? `IMAGE_${i}`),
        additionalCards,
      }),
    )
  }

  const preservedLayout = readPreservedLayoutFromMetadata(xisf.unit.metadata)
  const preservedHDUs: Array<{ index: number; hdu: FITSWriteHDU }> = []
  if (preservedLayout) {
    for (const preserved of preservedLayout.nonImageHDUs) {
      preservedHDUs.push({
        index: preserved.index,
        hdu: toFITSWriteHDU(preserved, await decodeBase64(preserved.dataBase64)),
      })
    }
  }

  if (xisf.unit.images.length === 0) {
    if (preservedHDUs.length === 0) {
      throw new XISFConversionError('No images or preserved FITS HDUs found in XISF unit')
    }
    const ordered = preservedLayout
      ? preservedHDUs.sort((a, b) => a.index - b.index).map((item) => item.hdu)
      : preservedHDUs.map((item) => item.hdu)
    return writeFITS(ordered)
  }

  let hdus: FITSWriteHDU[] = imageHDUs
  if (preservedLayout && preservedLayout.imageSourceIndices.length === imageHDUs.length) {
    const byIndex = new Map<number, FITSWriteHDU>()
    for (let i = 0; i < imageHDUs.length; i++) {
      byIndex.set(preservedLayout.imageSourceIndices[i]!, imageHDUs[i]!)
    }
    for (const preserved of preservedHDUs) {
      byIndex.set(preserved.index, preserved.hdu)
    }
    const maxIndex = Math.max(...byIndex.keys())
    const ordered: FITSWriteHDU[] = []
    for (let i = 0; i <= maxIndex; i++) {
      const hdu = byIndex.get(i)
      if (hdu) ordered.push(hdu)
    }
    hdus = ordered
  } else if (preservedHDUs.length > 0) {
    hdus = [
      ...imageHDUs,
      ...preservedHDUs.sort((a, b) => a.index - b.index).map((item) => item.hdu),
    ]
  }

  const includeMeta = options?.includeXisfMetaExtension ?? true
  if (includeMeta) {
    const metaJson = new TextEncoder().encode(buildXISFMetaJSON(xisf))
    hdus.push(
      createImageHDU({
        primary: false,
        extensionType: 'IMAGE',
        width: metaJson.byteLength,
        height: 1,
        bitpix: 8,
        data: metaJson,
        extname: 'XISF_META',
      }),
    )
  }

  return writeFITS(hdus)
}

async function collectImageFrames(image: Image): Promise<Array<number | bigint>> {
  const values: Array<number | bigint> = []
  const depth = image.depth
  for (let i = 0; i < depth; i++) {
    const frame = await image.getFrame(i)
    for (let p = 0; p < frame.length; p++) {
      const value = frame[p]!
      values.push(typeof value === 'bigint' ? value : Number(value))
    }
  }
  return values
}

async function collectCanonicalUInt64Frames(image: Image): Promise<Array<bigint>> {
  const values: bigint[] = []
  for (let frameIndex = 0; frameIndex < image.depth; frameIndex++) {
    const frameInfo = image.frameOffsets[frameIndex]!
    let frameBuffer = frameInfo.buffers?.[0]
    if (!frameBuffer) {
      if (image.buffer) {
        frameBuffer = image.buffer.slice(frameInfo.begin, frameInfo.begin + image.frameLength)
      } else if (image.blob) {
        frameBuffer = await image.blob
          .slice(frameInfo.begin, frameInfo.begin + image.frameLength)
          .arrayBuffer()
      } else {
        throw new XISFConversionError('Image data source is unavailable for UInt64 conversion')
      }
      frameInfo.buffers = [frameBuffer]
    }

    const view = new DataView(frameBuffer)
    const count = frameBuffer.byteLength / 8
    for (let i = 0; i < count; i++) {
      values.push(view.getBigInt64(i * 8, false) + U64_BZERO)
    }
  }
  return values
}

function imageSampleFormatFromFITS(
  header: FITS['hdus'][number]['header'],
  image: Image,
): XISFImage['sampleFormat'] {
  const bzero = image.bzero
  if (image.bitpix === 8) return 'UInt8'
  if (image.bitpix === 16 && bzero === U16_BZERO) return 'UInt16'
  if (image.bitpix === 32 && bzero === U32_BZERO) return 'UInt32'
  if (isCanonicalUInt64BITPIX64(header, image)) return 'UInt64'
  if (image.bitpix === -32) return 'Float32'
  if (image.bitpix === -64) return 'Float64'
  return 'Float64'
}

export async function convertFitsToXisf(
  input: ArrayBuffer | Blob | FITS,
  options?: ConversionOptions & { distributed?: boolean; writeOptions?: XISFWriteOptions },
): Promise<ArrayBuffer | { header: Uint8Array; blocks: Record<string, Uint8Array> }> {
  const strictValidation = isStrict(options)
  const writeOptions = options?.writeOptions
  const fits =
    input instanceof FITS
      ? input
      : FITS.fromArrayBuffer(await normalizeInputToArrayBuffer(input), {
          onWarning: strictValidation ? undefined : () => undefined,
        })

  const images: XISFImage[] = []
  const imageSourceIndices: number[] = []
  const preservedNonImageHDUs: PreservedHDU[] = []
  let restoredMeta: Partial<XISFUnit> = {}

  for (let i = 0; i < fits.hdus.length; i++) {
    const hdu = fits.hdus[i]!
    const header = hdu.header
    const extname = header.getString('EXTNAME', '')

    if (hdu.data && hdu.data instanceof BinaryTable && isHeaderTrue(header, 'XISFCPLX')) {
      const sampleFormat =
        header.getString('XISFSFMT', 'Complex32') === 'Complex64' ? 'Complex64' : 'Complex32'
      const width = header.getNumber('XISFWID')
      const height = header.getNumber('XISFHEI', 1)
      const depth = header.getNumber('XISFDEP', 1)
      const channelCount = header.getNumber('XISFCHN', 1)
      const rows = await hdu.data.getRows(0, hdu.data.rows)
      const rowObjects = rows as Array<Record<string, unknown>>
      const complexColumn = hdu.data.columns?.[0] ?? 'XISFCPLX'

      const components: number[] = []
      for (const row of rowObjects) {
        const pair = row[complexColumn]
        if (!Array.isArray(pair) || pair.length !== 2) {
          throw new XISFConversionError('Invalid complex payload in BINTABLE extension')
        }
        components.push(Number(pair[0]), Number(pair[1]))
      }

      images.push({
        id: extname || (i === 0 ? 'PRIMARY' : `IMAGE_${i}`),
        geometry: depth > 1 ? [width, height, depth] : [width, height],
        channelCount,
        sampleFormat,
        pixelStorage: 'Planar',
        colorSpace: 'Gray',
        dataBlock: {
          location: {
            type: 'attachment',
            position: 0,
            size: components.length * (sampleFormat === 'Complex32' ? 4 : 8),
          },
          byteOrder: 'little',
        },
        data: encodeComplexLittleEndian(components, sampleFormat),
        properties: [],
        tables: [],
        fitsKeywords: [],
      })
      imageSourceIndices.push(i)
      continue
    }

    if (!hdu.data || !(hdu.data instanceof Image)) {
      preservedNonImageHDUs.push(await toPreservedHDU(hdu, i))
      continue
    }

    if (extname === 'XISF_META') {
      const frame = await hdu.data.getFrame(0)
      const bytes = new Uint8Array(frame.length)
      for (let j = 0; j < frame.length; j++) {
        bytes[j] = Number(frame[j]!) & 0xff
      }
      try {
        const decoded = JSON.parse(new TextDecoder('utf-8').decode(bytes)) as Partial<XISFUnit>
        restoredMeta = decoded
      } catch {
        // ignore malformed metadata extension in relaxed conversion
      }
      continue
    }

    const sampleFormat = imageSampleFormatFromFITS(header, hdu.data)
    if (strictValidation && hdu.data.bitpix === 64 && sampleFormat !== 'UInt64') {
      throw new XISFConversionError(
        'FITS BITPIX=64 without canonical UInt64 BZERO cannot be converted losslessly',
      )
    }
    const values =
      sampleFormat === 'UInt64'
        ? await collectCanonicalUInt64Frames(hdu.data)
        : await collectImageFrames(hdu.data)
    const data = encodeLittleEndian(values, sampleFormat)

    const fitsKeywords = header.getCards().map((card) => {
      return {
        name: card.key,
        value: formatFITSKeywordValue(card.value),
        comment: card.comment,
      }
    })

    const geometry: number[] = [hdu.data.width, hdu.data.height]
    if (hdu.data.depth > 1) {
      geometry.push(hdu.data.depth)
    }

    images.push({
      id: extname || (i === 0 ? 'PRIMARY' : `IMAGE_${i}`),
      geometry,
      channelCount: 1,
      sampleFormat,
      bounds: sampleFormat.startsWith('Float') ? [0, 1] : undefined,
      pixelStorage: 'Planar',
      colorSpace: 'Gray',
      dataBlock: {
        location: { type: 'attachment', position: 0, size: data.byteLength },
        byteOrder: 'little',
      },
      data,
      properties: [],
      tables: [],
      fitsKeywords,
    })
    imageSourceIndices.push(i)
  }

  if (images.length === 0) {
    if (preservedNonImageHDUs.length === 0) {
      throw new XISFConversionError('No convertible FITS image HDUs found')
    }
  }

  let metadata: XISFUnit['metadata'] = restoredMeta.metadata ?? [
    { id: 'XISF:CreatorApplication', type: 'String', value: 'fitsjs-ng conversion' },
    { id: 'XISF:CreationTime', type: 'TimePoint', value: new Date().toISOString() },
  ]
  if (preservedNonImageHDUs.length > 0) {
    const layout: PreservedHDULayout = {
      imageSourceIndices,
      nonImageHDUs: preservedNonImageHDUs,
    }
    metadata = upsertMetadataString(
      metadata,
      FITS_PRESERVED_LAYOUT_PROPERTY,
      JSON.stringify(layout),
    )
  }

  const unit: XISFUnit = {
    metadata,
    images,
    standaloneProperties: restoredMeta.standaloneProperties ?? [],
    standaloneTables: restoredMeta.standaloneTables ?? [],
    version: '1.0',
    signature: { present: false, verified: true },
  }

  if (options?.distributed) {
    return XISFWriter.toDistributed(unit, writeOptions)
  }
  return XISFWriter.toMonolithic(unit, writeOptions)
}
