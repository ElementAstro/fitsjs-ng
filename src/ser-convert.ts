import { FITS } from './fits'
import { Image } from './image'
import { BinaryTable } from './binary-table'
import { XISF } from './xisf'
import { XISFWriter } from './xisf-writer'
import {
  createImageBytesFromArray,
  createImageHDU,
  type FITSWriteHDU,
  writeFITS,
} from './fits-writer'
import { writeSER } from './ser-writer'
import { SER } from './ser'
import { SERConversionError } from './ser-errors'
import {
  SER_BAYER_OR_CMY_PATTERN,
  SER_COLOR_CHANNELS,
  type FitsToSerOptions,
  type SERColorId,
  type SERConversionOptions,
  type SERFrameData,
  type SerToFitsOptions,
  type SerToXisfOptions,
  type XisfToSerOptions,
} from './ser-types'
import type { XISFImage, XISFProperty, XISFUnit } from './xisf-types'

const SER_COLOR_CARD = 'SERCOLOR'
const SER_PIXEL_DEPTH_CARD = 'SERPDEP'
const SER_FRAME_COUNT_CARD = 'SERFRMS'
const SER_CHANNELS_CARD = 'SERCHANS'
const SER_CHANNEL_ORDER_CARD = 'SERCHORD'
const SER_LUID_CARD = 'SERLUID'
const SER_BYTE_ORDER_CARD = 'SERBYORD'
const SER_OBSERVER_CARD = 'SEROBS'
const SER_INSTRUMENT_CARD = 'SERINST'
const SER_TELESCOPE_CARD = 'SERTEL'
const SER_START_TIME_CARD = 'SERSTRT'
const SER_START_TIME_UTC_CARD = 'SERSTUTC'
const SER_CFA_CARD = 'SERCFAP'
const SER_FRAME_CARD = 'SERFRAME'
const SER_TS_EXTNAME = 'SER_TSTP'

const U16_BZERO = 32768

function isStrict(options?: SERConversionOptions): boolean {
  return options?.strictValidation ?? options?.relaxed !== true
}

function toArrayBufferLike(input: ArrayBuffer | Blob): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return Promise.resolve(input)
  return input.arrayBuffer()
}

function asSER(input: ArrayBuffer | Blob | SER, options?: SERConversionOptions): Promise<SER> {
  if (input instanceof SER) return Promise.resolve(input)
  if (input instanceof ArrayBuffer) {
    return Promise.resolve(
      SER.fromArrayBuffer(input, {
        strictValidation: isStrict(options),
        endiannessPolicy: options?.endiannessPolicy,
        onWarning: options?.onWarning,
      }),
    )
  }
  return SER.fromBlob(input, {
    strictValidation: isStrict(options),
    endiannessPolicy: options?.endiannessPolicy,
    onWarning: options?.onWarning,
  })
}

function asFits(input: ArrayBuffer | Blob | FITS): Promise<FITS> {
  if (input instanceof FITS) return Promise.resolve(input)
  if (input instanceof ArrayBuffer) {
    return Promise.resolve(FITS.fromArrayBuffer(input))
  }
  return toArrayBufferLike(input).then((buffer) => FITS.fromArrayBuffer(buffer))
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      return BigInt(trimmed)
    } catch {
      return null
    }
  }
  return null
}

function getMetadata(unit: XISFUnit, id: string): XISFProperty | undefined {
  return unit.metadata.find((item) => item.id === id)
}

function getImageProperty(image: XISFImage, id: string): XISFProperty | undefined {
  return image.properties.find((item) => item.id === id)
}

function getSerMetadataScalar(unit: XISFUnit, image: XISFImage, id: string): unknown {
  const imageProperty = getImageProperty(image, id)
  if (imageProperty?.value !== undefined) {
    return imageProperty.value
  }
  return getMetadata(unit, id)?.value
}

function getSerMetadataBigIntArray(unit: XISFUnit, image: XISFImage, id: string): bigint[] {
  const value = getSerMetadataScalar(unit, image, id)
  if (!value) return []

  if (ArrayBuffer.isView(value)) {
    const arr = value as unknown as ArrayLike<number | bigint>
    const out: bigint[] = []
    for (let i = 0; i < arr.length; i++) {
      out.push(BigInt(arr[i]!))
    }
    return out
  }

  if (Array.isArray(value)) {
    return value.map((item) => toBigInt(item)).filter((item): item is bigint => item !== null)
  }

  return []
}

function emitConversionWarning(
  options: SERConversionOptions | undefined,
  code: string,
  message: string,
): void {
  options?.onWarning?.({ code, message })
}

function pushSERMetadataProperties(
  unitMetadata: XISFUnit['metadata'],
  ser: SER,
): XISFUnit['metadata'] {
  const header = ser.getHeader()
  const out = [...unitMetadata]
  out.push({ id: 'SER:ColorID', type: 'Int32', value: header.colorId })
  out.push({ id: 'SER:PixelDepth', type: 'Int32', value: header.pixelDepth })
  out.push({ id: 'SER:FrameCount', type: 'Int32', value: header.frameCount })
  out.push({ id: 'SER:ChannelCount', type: 'Int32', value: header.channelCount })
  out.push({ id: 'SER:LittleEndian', type: 'Boolean', value: header.byteOrder === 'little' })
  out.push({ id: 'SER:LuID', type: 'Int32', value: header.luId })
  out.push({ id: 'SER:Observer', type: 'String', value: header.observer })
  out.push({ id: 'SER:Instrument', type: 'String', value: header.instrument })
  out.push({ id: 'SER:Telescope', type: 'String', value: header.telescope })
  out.push({ id: 'SER:StartTime', type: 'String', value: header.startTime.toString() })
  out.push({ id: 'SER:StartTimeUTC', type: 'String', value: header.startTimeUtc.toString() })

  const timestamps = ser.parsed.timestamps
  if (timestamps.length > 0) {
    const vec = new BigUint64Array(timestamps.length)
    for (let i = 0; i < timestamps.length; i++) {
      vec[i] = timestamps[i]!
    }
    out.push({
      id: 'SER:FrameTimestamps',
      type: 'UI64Vector',
      value: vec,
      dataBlock: {
        location: { type: 'attachment', position: 0, size: vec.byteLength },
        byteOrder: 'little',
      },
    })
  }
  return out
}

function frameSamplesToU8(frame: SERFrameData): Uint8Array {
  if (frame.samples instanceof Uint8Array) return frame.samples
  const out = new Uint8Array(frame.samples.length)
  for (let i = 0; i < frame.samples.length; i++) {
    out[i] = Number(frame.samples[i] ?? 0) & 0xff
  }
  return out
}

function frameSamplesToU16(frame: SERFrameData): Uint16Array {
  if (frame.samples instanceof Uint16Array) return frame.samples
  const out = new Uint16Array(frame.samples.length)
  for (let i = 0; i < frame.samples.length; i++) {
    out[i] = Number(frame.samples[i] ?? 0)
  }
  return out
}

function buildTimestampExtension(timestamps: bigint[]): FITSWriteHDU {
  const data = new Uint8Array(timestamps.length * 8)
  const view = new DataView(data.buffer)
  for (let i = 0; i < timestamps.length; i++) {
    view.setBigInt64(i * 8, BigInt(timestamps[i]!), false)
  }

  return {
    cards: [
      { key: 'XTENSION', value: 'BINTABLE', comment: 'Binary table extension' },
      { key: 'BITPIX', value: 8, comment: '8-bit bytes' },
      { key: 'NAXIS', value: 2, comment: 'Table axes' },
      { key: 'NAXIS1', value: 8, comment: 'Bytes per row' },
      { key: 'NAXIS2', value: timestamps.length, comment: 'Rows' },
      { key: 'PCOUNT', value: 0 },
      { key: 'GCOUNT', value: 1 },
      { key: 'TFIELDS', value: 1 },
      { key: 'TTYPE1', value: 'TIMESTAMP' },
      { key: 'TFORM1', value: '1K' },
      { key: 'EXTNAME', value: SER_TS_EXTNAME },
    ],
    data,
  }
}

function inferColorIdFromXisf(image: XISFImage): SERColorId {
  if (image.channelCount === 3) return 100
  const pattern = image.colorFilterArray?.pattern
  if (!pattern) return 0
  const entry = Object.entries(SER_BAYER_OR_CMY_PATTERN).find(([, value]) => value === pattern)
  if (!entry) return 0
  return Number(entry[0]) as SERColorId
}

function parseHeaderCardBigInt(
  header: FITS['hdus'][number]['header'],
  key: string,
): bigint | undefined {
  const raw = header.get(key)
  const parsed = toBigInt(raw)
  return parsed ?? undefined
}

function parseHeaderCardNumber(
  header: FITS['hdus'][number]['header'],
  key: string,
): number | undefined {
  const raw = header.get(key)
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const num = Number(raw)
    if (Number.isFinite(num)) return num
  }
  return undefined
}

function parseHeaderCardString(
  header: FITS['hdus'][number]['header'],
  key: string,
): string | undefined {
  const raw = header.get(key)
  return typeof raw === 'string' ? raw : undefined
}

function buildSerMetadataCards(ser: SER): FITSWriteHDU['cards'] {
  const header = ser.getHeader()
  const cfaPattern = SER_BAYER_OR_CMY_PATTERN[header.colorId]
  return [
    { key: SER_COLOR_CARD, value: header.colorId },
    { key: SER_PIXEL_DEPTH_CARD, value: header.pixelDepth },
    { key: SER_FRAME_COUNT_CARD, value: header.frameCount },
    { key: SER_CHANNELS_CARD, value: header.channelCount },
    { key: SER_CHANNEL_ORDER_CARD, value: header.colorId === 101 ? 'BGR' : 'RGB' },
    { key: SER_LUID_CARD, value: header.luId },
    { key: SER_BYTE_ORDER_CARD, value: header.byteOrder },
    { key: SER_OBSERVER_CARD, value: header.observer },
    { key: SER_INSTRUMENT_CARD, value: header.instrument },
    { key: SER_TELESCOPE_CARD, value: header.telescope },
    { key: SER_START_TIME_CARD, value: header.startTime.toString() },
    { key: SER_START_TIME_UTC_CARD, value: header.startTimeUtc.toString() },
    ...(cfaPattern ? [{ key: SER_CFA_CARD, value: cfaPattern }] : []),
  ]
}

function toPlanarFrameValues(frame: SERFrameData): number[] {
  const out: number[] = []
  if (frame.channelCount === 1) {
    for (let p = 0; p < frame.samples.length; p++) {
      out.push(Number(frame.samples[p] ?? 0))
    }
    return out
  }

  const pixels = frame.width * frame.height
  for (let ch = 0; ch < 3; ch++) {
    for (let p = 0; p < pixels; p++) {
      out.push(Number(frame.samples[p * 3 + ch] ?? 0))
    }
  }
  return out
}

function applyU16FitsOffset(values: number[]): number[] {
  return values.map((value) => value - U16_BZERO)
}

type ImageHDUWithImage = {
  header: FITS['hdus'][number]['header']
  image: Image
}

function getImageHDUs(fits: FITS): ImageHDUWithImage[] {
  return fits.hdus
    .filter((hdu): hdu is FITS['hdus'][number] & { data: Image } => hdu.data instanceof Image)
    .map((hdu) => ({ header: hdu.header, image: hdu.data }))
}

function inferFitsSourceLayout(
  options: FitsToSerOptions | undefined,
  imageHDUs: ImageHDUWithImage[],
  metadataFrameCount: number | undefined,
): 'cube' | 'multi-hdu' {
  if (options?.sourceLayout === 'cube' || options?.sourceLayout === 'multi-hdu') {
    return options.sourceLayout
  }

  if (imageHDUs.length <= 1) return 'cube'

  const hasFrameMarkers = imageHDUs.some(({ header }) => {
    const extname = header.getString('EXTNAME', '').trim().toUpperCase()
    return (
      header.contains(SER_FRAME_CARD) || extname.startsWith('SER_FRAME_') || extname === 'SER_FRAME'
    )
  })
  if (hasFrameMarkers) return 'multi-hdu'

  if (metadataFrameCount !== undefined) {
    if (imageHDUs.length === metadataFrameCount || imageHDUs.length === metadataFrameCount * 3) {
      return 'multi-hdu'
    }
  }

  const first = imageHDUs[0]!
  const sameShape = imageHDUs.every(
    (item) =>
      item.image.width === first.image.width &&
      item.image.height === first.image.height &&
      item.image.bitpix === first.image.bitpix,
  )
  return sameShape ? 'multi-hdu' : 'cube'
}

function normalizeMultiHduImages(
  imageHDUs: ImageHDUWithImage[],
  strictValidation: boolean,
  options?: SERConversionOptions,
): ImageHDUWithImage[] {
  const reference = imageHDUs[0]?.image
  if (!reference) return imageHDUs

  const compatible = imageHDUs.filter((hdu, index) => {
    const sameShape =
      hdu.image.width === reference.width &&
      hdu.image.height === reference.height &&
      hdu.image.bitpix === reference.bitpix
    if (sameShape) return true

    const message = `Skipping incompatible image HDU #${index} (${hdu.image.width}x${hdu.image.height}, BITPIX=${hdu.image.bitpix}); expected ${reference.width}x${reference.height}, BITPIX=${reference.bitpix}`
    if (strictValidation) {
      throw new SERConversionError(message)
    }
    emitConversionWarning(options, 'fits_multi_hdu_incompatible', message)
    return false
  })

  if (compatible.length === 0) {
    throw new SERConversionError('No compatible image HDUs available for multi-HDU FITS conversion')
  }
  return compatible
}

async function extractMonoFrameBytes(
  image: Image,
  frameIndex: number,
  bytesPerSample: 1 | 2,
  littleEndian: boolean,
): Promise<Uint8Array> {
  const pixelsPerFrame = image.width * image.height
  const out = new Uint8Array(pixelsPerFrame * bytesPerSample)
  const samples = await image.getFrame(frameIndex)
  if (bytesPerSample === 1) {
    for (let i = 0; i < pixelsPerFrame; i++) out[i] = Number(samples[i] ?? 0) & 0xff
    return out
  }

  const view = new DataView(out.buffer)
  for (let i = 0; i < pixelsPerFrame; i++) {
    view.setUint16(i * 2, Number(samples[i] ?? 0), littleEndian)
  }
  return out
}

async function extractRgbFrameBytesFromCube(
  image: Image,
  frameIndex: number,
  bytesPerSample: 1 | 2,
  littleEndian: boolean,
): Promise<Uint8Array> {
  const pixelsPerFrame = image.width * image.height
  const out = new Uint8Array(pixelsPerFrame * 3 * bytesPerSample)
  const channelFrames = await Promise.all([
    image.getFrame(frameIndex * 3),
    image.getFrame(frameIndex * 3 + 1),
    image.getFrame(frameIndex * 3 + 2),
  ])
  if (bytesPerSample === 1) {
    for (let p = 0; p < pixelsPerFrame; p++) {
      out[p * 3] = Number(channelFrames[0]![p] ?? 0) & 0xff
      out[p * 3 + 1] = Number(channelFrames[1]![p] ?? 0) & 0xff
      out[p * 3 + 2] = Number(channelFrames[2]![p] ?? 0) & 0xff
    }
    return out
  }

  const view = new DataView(out.buffer)
  for (let p = 0; p < pixelsPerFrame; p++) {
    view.setUint16(p * 6, Number(channelFrames[0]![p] ?? 0), littleEndian)
    view.setUint16(p * 6 + 2, Number(channelFrames[1]![p] ?? 0), littleEndian)
    view.setUint16(p * 6 + 4, Number(channelFrames[2]![p] ?? 0), littleEndian)
  }
  return out
}

async function extractRgbFrameBytesFromHduTriplet(
  rImage: Image,
  gImage: Image,
  bImage: Image,
  bytesPerSample: 1 | 2,
  littleEndian: boolean,
): Promise<Uint8Array> {
  const pixelsPerFrame = rImage.width * rImage.height
  const out = new Uint8Array(pixelsPerFrame * 3 * bytesPerSample)
  const [rFrame, gFrame, bFrame] = await Promise.all([
    rImage.getFrame(0),
    gImage.getFrame(0),
    bImage.getFrame(0),
  ])
  if (bytesPerSample === 1) {
    for (let p = 0; p < pixelsPerFrame; p++) {
      out[p * 3] = Number(rFrame[p] ?? 0) & 0xff
      out[p * 3 + 1] = Number(gFrame[p] ?? 0) & 0xff
      out[p * 3 + 2] = Number(bFrame[p] ?? 0) & 0xff
    }
    return out
  }

  const view = new DataView(out.buffer)
  for (let p = 0; p < pixelsPerFrame; p++) {
    view.setUint16(p * 6, Number(rFrame[p] ?? 0), littleEndian)
    view.setUint16(p * 6 + 2, Number(gFrame[p] ?? 0), littleEndian)
    view.setUint16(p * 6 + 4, Number(bFrame[p] ?? 0), littleEndian)
  }
  return out
}

export async function convertSerToFits(
  input: ArrayBuffer | Blob | SER,
  options?: SerToFitsOptions,
): Promise<ArrayBuffer> {
  const ser = await asSER(input, options)
  const header = ser.getHeader()
  const frameCount = header.frameCount

  const cards = buildSerMetadataCards(ser)
  const layout = options?.layout ?? 'cube'
  const bitpix: 8 | 16 = header.bytesPerSample === 1 ? 8 : 16
  const bzero = bitpix === 16 ? U16_BZERO : undefined

  const hdus: FITSWriteHDU[] = []
  if (layout === 'multi-hdu') {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const frame = ser.getFrame(frameIndex)
      const baseValues = toPlanarFrameValues(frame)
      const values = bitpix === 16 ? applyU16FitsOffset(baseValues) : baseValues
      const data = createImageBytesFromArray(values, bitpix)
      hdus.push(
        createImageHDU({
          primary: frameIndex === 0,
          extensionType: 'IMAGE',
          width: header.width,
          height: header.height,
          depth: header.channelCount === 3 ? 3 : undefined,
          bitpix,
          bzero,
          bscale: bzero !== undefined ? 1 : undefined,
          data,
          extname: frameIndex === 0 ? undefined : `SER_FRAME_${frameIndex}`,
          additionalCards:
            frameIndex === 0
              ? cards
              : [
                  { key: SER_FRAME_CARD, value: frameIndex },
                  { key: SER_FRAME_COUNT_CARD, value: frameCount },
                  { key: SER_CHANNELS_CARD, value: header.channelCount },
                ],
        }),
      )
    }
  } else {
    const depth = header.channelCount === 1 ? frameCount : frameCount * 3
    const values: number[] = []
    for (let i = 0; i < frameCount; i++) {
      const frame = ser.getFrame(i)
      const baseValues = toPlanarFrameValues(frame)
      const mapped = bitpix === 16 ? applyU16FitsOffset(baseValues) : baseValues
      values.push(...mapped)
    }
    const imageData = createImageBytesFromArray(values, bitpix)
    hdus.push(
      createImageHDU({
        width: header.width,
        height: header.height,
        depth,
        bitpix,
        bzero,
        bscale: bzero !== undefined ? 1 : undefined,
        data: imageData,
        additionalCards: cards,
      }),
    )
  }

  if ((options?.includeTimestampExtension ?? true) && ser.parsed.timestamps.length === frameCount) {
    hdus.push(buildTimestampExtension(ser.parsed.timestamps))
  }

  return writeFITS(hdus)
}

export async function convertFitsToSer(
  input: ArrayBuffer | Blob | FITS,
  options?: FitsToSerOptions,
): Promise<ArrayBuffer> {
  const strictValidation = isStrict(options)
  const fits = await asFits(input)
  const imageHDUs = getImageHDUs(fits)
  const imageHDU = imageHDUs[0]
  if (!imageHDU) {
    throw new SERConversionError('No FITS image HDU found for SER conversion')
  }

  const header = imageHDU.header
  const image = imageHDU.image
  const colorId = (parseHeaderCardNumber(header, SER_COLOR_CARD) ?? 0) as SERColorId
  const channelCount = SER_COLOR_CHANNELS[colorId] ?? 1

  let pixelDepth = parseHeaderCardNumber(header, SER_PIXEL_DEPTH_CARD)
  if (!pixelDepth) {
    if (image.bitpix === 8) pixelDepth = 8
    else if (image.bitpix === 16) pixelDepth = 16
    else {
      throw new SERConversionError(
        `Cannot infer SER pixel depth from FITS BITPIX=${image.bitpix}; metadata is missing`,
      )
    }
  }

  const metadataFrameCount = parseHeaderCardNumber(header, SER_FRAME_COUNT_CARD)
  const sourceLayout = inferFitsSourceLayout(options, imageHDUs, metadataFrameCount)
  const bytesPerSample = pixelDepth <= 8 ? 1 : (2 as 1 | 2)
  const layoutImageHDUs =
    sourceLayout === 'multi-hdu'
      ? normalizeMultiHduImages(imageHDUs, strictValidation, options)
      : imageHDUs

  const littleEndian = (parseHeaderCardString(header, SER_BYTE_ORDER_CARD) ?? 'little') !== 'big'
  const observer = parseHeaderCardString(header, SER_OBSERVER_CARD) ?? ''
  const instrument = parseHeaderCardString(header, SER_INSTRUMENT_CARD) ?? ''
  const telescope = parseHeaderCardString(header, SER_TELESCOPE_CARD) ?? ''
  const luId = parseHeaderCardNumber(header, SER_LUID_CARD) ?? 0
  const startTime = parseHeaderCardBigInt(header, SER_START_TIME_CARD) ?? 0n
  const startTimeUtc = parseHeaderCardBigInt(header, SER_START_TIME_UTC_CARD) ?? startTime

  const frames: Uint8Array[] = []
  let frameCount = metadataFrameCount ?? 0
  if (sourceLayout === 'cube') {
    if (channelCount === 1) {
      frameCount = metadataFrameCount ?? image.depth
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        frames.push(await extractMonoFrameBytes(image, frameIndex, bytesPerSample, littleEndian))
      }
    } else {
      frameCount = metadataFrameCount ?? image.depth
      if (!metadataFrameCount) {
        if (image.depth % 3 !== 0) {
          if (strictValidation) {
            throw new SERConversionError(
              `FITS depth ${image.depth} is not divisible by 3 for RGB/BGR SER reconstruction`,
            )
          }
          frameCount = Math.floor(image.depth / 3)
        } else {
          frameCount = image.depth / 3
        }
      }
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
        frames.push(
          await extractRgbFrameBytesFromCube(image, frameIndex, bytesPerSample, littleEndian),
        )
      }
    }
  } else {
    if (channelCount === 1) {
      for (const hdu of layoutImageHDUs) {
        if (hdu.image.depth > 1) {
          for (let frameIndex = 0; frameIndex < hdu.image.depth; frameIndex++) {
            frames.push(
              await extractMonoFrameBytes(hdu.image, frameIndex, bytesPerSample, littleEndian),
            )
          }
        } else {
          frames.push(await extractMonoFrameBytes(hdu.image, 0, bytesPerSample, littleEndian))
        }
      }
    } else {
      const allDepth3 = layoutImageHDUs.every((hdu) => hdu.image.depth === 3)
      const allDepth1 = layoutImageHDUs.every((hdu) => hdu.image.depth === 1)
      if (allDepth3) {
        for (const hdu of layoutImageHDUs) {
          frames.push(
            await extractRgbFrameBytesFromCube(hdu.image, 0, bytesPerSample, littleEndian),
          )
        }
      } else if (allDepth1) {
        let frameHduCount = layoutImageHDUs.length
        if (frameHduCount % 3 !== 0) {
          const message = `RGB/BGR multi-HDU layout has ${frameHduCount} channels; expected multiple of 3`
          if (strictValidation) {
            throw new SERConversionError(message)
          }
          emitConversionWarning(options, 'fits_multi_hdu_rgb_tail_drop', message)
          frameHduCount -= frameHduCount % 3
        }
        for (let i = 0; i + 2 < frameHduCount; i += 3) {
          frames.push(
            await extractRgbFrameBytesFromHduTriplet(
              layoutImageHDUs[i]!.image,
              layoutImageHDUs[i + 1]!.image,
              layoutImageHDUs[i + 2]!.image,
              bytesPerSample,
              littleEndian,
            ),
          )
        }
      } else {
        throw new SERConversionError(
          'Cannot decode RGB/BGR sequence from multi-HDU FITS layout; expected depth=3 per HDU or HDU triplets',
        )
      }
    }
    frameCount = frames.length
  }

  let timestamps: bigint[] | undefined
  const tsHdu = fits.hdus.find(
    (hdu) =>
      hdu.data instanceof BinaryTable &&
      hdu.header.getString('EXTNAME', '').trim().toUpperCase() === SER_TS_EXTNAME,
  )
  if (tsHdu && tsHdu.data instanceof BinaryTable) {
    const colName = tsHdu.data.columns?.[0]
    if (colName) {
      const values = await tsHdu.data.getColumn(colName)
      timestamps = values
        .map((item) => toBigInt(item))
        .filter((item): item is bigint => item !== null)
      if (timestamps.length !== frameCount) {
        if (strictValidation) {
          throw new SERConversionError(
            `SER timestamp extension row count mismatch: expected ${frameCount}, got ${timestamps.length}`,
          )
        }
        timestamps = timestamps.slice(0, frameCount)
      }
    }
  }

  return writeSER(
    {
      header: {
        colorId,
        width: image.width,
        height: image.height,
        pixelDepth,
        frameCount,
        littleEndian,
        luId,
        observer,
        instrument,
        telescope,
        startTime,
        startTimeUtc,
      },
      frames,
      timestamps,
    },
    {
      strictValidation,
      endiannessPolicy: options?.endiannessPolicy === 'spec' ? 'spec' : 'compat',
      onWarning: options?.onWarning,
    },
  )
}

function sampleFormatFromSerBytes(bytesPerSample: number): XISFImage['sampleFormat'] {
  return bytesPerSample === 1 ? 'UInt8' : 'UInt16'
}

function buildSerImageDataForXisf(ser: SER): Uint8Array {
  const header = ser.getHeader()
  const frameCount = header.frameCount
  const frameSamples = header.width * header.height * header.channelCount
  const totalSamples = frameSamples * frameCount

  if (header.bytesPerSample === 1) {
    const out = new Uint8Array(totalSamples)
    let offset = 0
    for (let i = 0; i < frameCount; i++) {
      const frame = ser.getFrame(i)
      const samples = frameSamplesToU8(frame)
      out.set(samples, offset)
      offset += samples.length
    }
    return out
  }

  const out = new Uint8Array(totalSamples * 2)
  const outView = new DataView(out.buffer)
  let sampleOffset = 0
  for (let i = 0; i < frameCount; i++) {
    const frame = ser.getFrame(i)
    const samples = frameSamplesToU16(frame)
    for (let s = 0; s < samples.length; s++) {
      outView.setUint16(sampleOffset * 2, samples[s]!, true)
      sampleOffset++
    }
  }
  return out
}

export async function convertSerToXisf(
  input: ArrayBuffer | Blob | SER,
  options?: SerToXisfOptions,
): Promise<ArrayBuffer | { header: Uint8Array; blocks: Record<string, Uint8Array> }> {
  const ser = await asSER(input, options)
  const header = ser.getHeader()
  const imageData = buildSerImageDataForXisf(ser)

  const image: XISFImage = {
    id: 'SER_SEQUENCE',
    geometry: [header.width, header.height, header.frameCount],
    channelCount: header.channelCount,
    sampleFormat: sampleFormatFromSerBytes(header.bytesPerSample),
    pixelStorage: header.channelCount === 3 ? 'Normal' : 'Planar',
    colorSpace: header.channelCount === 3 ? 'RGB' : 'Gray',
    dataBlock: {
      location: { type: 'attachment', position: 0, size: imageData.byteLength },
      byteOrder: 'little',
    },
    data: imageData,
    properties: [],
    tables: [],
    fitsKeywords: [],
  }

  const cfaPattern = SER_BAYER_OR_CMY_PATTERN[header.colorId]
  if (cfaPattern) {
    image.colorFilterArray = { pattern: cfaPattern, width: 2, height: 2 }
  }

  let metadata: XISFUnit['metadata'] = [
    { id: 'XISF:CreatorApplication', type: 'String', value: 'fitsjs-ng SER conversion' },
    { id: 'XISF:CreationTime', type: 'TimePoint', value: new Date().toISOString() },
  ]
  metadata = pushSERMetadataProperties(metadata, ser)

  const unit: XISFUnit = {
    metadata,
    images: [image],
    standaloneProperties: [],
    standaloneTables: [],
    version: '1.0',
    signature: { present: false, verified: true },
  }

  if (options?.distributed) {
    return XISFWriter.toDistributed(unit, options.writeOptions)
  }
  return XISFWriter.toMonolithic(unit, options?.writeOptions)
}

function extractImageBytes(image: XISFImage): Uint8Array {
  if (!image.data) {
    throw new SERConversionError('XISF image data is not decoded')
  }
  return image.data
}

function decodeXisfImageFramesToSer(
  image: XISFImage,
  frameCount: number,
  channelCount: number,
  littleEndianOut: boolean,
): Uint8Array[] {
  const width = image.geometry[0] ?? 0
  const height = image.geometry[1] ?? 0
  const pixels = width * height
  const sampleSize = image.sampleFormat === 'UInt16' ? 2 : 1
  const outFrameBytes = pixels * channelCount * sampleSize
  const bytes = extractImageBytes(image)
  const expectedLength = pixels * channelCount * frameCount * sampleSize
  if (bytes.byteLength < expectedLength) {
    throw new SERConversionError(
      `XISF image payload too short for SER conversion: expected at least ${expectedLength} bytes, got ${bytes.byteLength}`,
    )
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const inputLittle = image.dataBlock.byteOrder !== 'big'
  const frames: Uint8Array[] = []

  if (sampleSize === 1) {
    if (channelCount === 1) {
      for (let f = 0; f < frameCount; f++) {
        const frame = new Uint8Array(outFrameBytes)
        const offset = f * pixels
        frame.set(bytes.subarray(offset, offset + pixels))
        frames.push(frame)
      }
    } else if (image.pixelStorage === 'Normal') {
      for (let f = 0; f < frameCount; f++) {
        const frame = new Uint8Array(outFrameBytes)
        const offset = f * pixels * channelCount
        frame.set(bytes.subarray(offset, offset + pixels * channelCount))
        frames.push(frame)
      }
    } else {
      const planeSize = pixels * frameCount
      for (let f = 0; f < frameCount; f++) {
        const frame = new Uint8Array(outFrameBytes)
        for (let p = 0; p < pixels; p++) {
          frame[p * 3] = bytes[f * pixels + p] ?? 0
          frame[p * 3 + 1] = bytes[planeSize + f * pixels + p] ?? 0
          frame[p * 3 + 2] = bytes[planeSize * 2 + f * pixels + p] ?? 0
        }
        frames.push(frame)
      }
    }
    return frames
  }

  if (channelCount === 1) {
    for (let f = 0; f < frameCount; f++) {
      const frame = new Uint8Array(outFrameBytes)
      const outView = new DataView(frame.buffer)
      for (let p = 0; p < pixels; p++) {
        const value = view.getUint16((f * pixels + p) * 2, inputLittle)
        outView.setUint16(p * 2, value, littleEndianOut)
      }
      frames.push(frame)
    }
    return frames
  }

  if (image.pixelStorage === 'Normal') {
    for (let f = 0; f < frameCount; f++) {
      const frame = new Uint8Array(outFrameBytes)
      const outView = new DataView(frame.buffer)
      for (let p = 0; p < pixels; p++) {
        const baseIn = (f * pixels * channelCount + p * channelCount) * 2
        const baseOut = p * channelCount * 2
        outView.setUint16(baseOut, view.getUint16(baseIn, inputLittle), littleEndianOut)
        outView.setUint16(baseOut + 2, view.getUint16(baseIn + 2, inputLittle), littleEndianOut)
        outView.setUint16(baseOut + 4, view.getUint16(baseIn + 4, inputLittle), littleEndianOut)
      }
      frames.push(frame)
    }
    return frames
  }

  const planeSize = pixels * frameCount
  for (let f = 0; f < frameCount; f++) {
    const frame = new Uint8Array(outFrameBytes)
    const outView = new DataView(frame.buffer)
    for (let p = 0; p < pixels; p++) {
      const r = view.getUint16((f * pixels + p) * 2, inputLittle)
      const g = view.getUint16((planeSize + f * pixels + p) * 2, inputLittle)
      const b = view.getUint16((planeSize * 2 + f * pixels + p) * 2, inputLittle)
      const base = p * 6
      outView.setUint16(base, r, littleEndianOut)
      outView.setUint16(base + 2, g, littleEndianOut)
      outView.setUint16(base + 4, b, littleEndianOut)
    }
    frames.push(frame)
  }
  return frames
}

export async function convertXisfToSer(
  input: ArrayBuffer | Blob | XISF,
  options?: XisfToSerOptions,
): Promise<ArrayBuffer> {
  const strictValidation = isStrict(options)
  const xisf =
    input instanceof XISF
      ? input
      : await XISF.fromArrayBuffer(await toArrayBufferLike(input), {
          strictValidation,
          decodeImageData: true,
        })

  const imageIndex = options?.imageIndex ?? 0
  if (!Number.isInteger(imageIndex) || imageIndex < 0) {
    throw new SERConversionError(
      `XISF image index must be a non-negative integer, got ${imageIndex}`,
    )
  }
  const image = xisf.unit.images[imageIndex]
  if (!image) {
    throw new SERConversionError(`No XISF image available at index ${imageIndex}`)
  }

  if (image.sampleFormat !== 'UInt8' && image.sampleFormat !== 'UInt16') {
    throw new SERConversionError(
      `Unsupported XISF sample format for SER conversion: ${image.sampleFormat}`,
    )
  }

  const width = image.geometry[0] ?? 0
  const height = image.geometry[1] ?? 0
  if (!width || !height) {
    throw new SERConversionError('XISF image must have width and height geometry')
  }

  const metaColor = getSerMetadataScalar(xisf.unit, image, 'SER:ColorID')
  const colorId = (toBigInt(metaColor) ?? BigInt(inferColorIdFromXisf(image))) as bigint
  const color = Number(colorId) as SERColorId
  const channelCount = SER_COLOR_CHANNELS[color] ?? (image.channelCount === 3 ? 3 : 1)

  const frameCount = image.geometry[2] ?? 1
  const pixelDepthMeta = getSerMetadataScalar(xisf.unit, image, 'SER:PixelDepth')
  const pixelDepth =
    Number(toBigInt(pixelDepthMeta) ?? (image.sampleFormat === 'UInt8' ? 8n : 16n)) || 8

  const littleEndianMeta = getSerMetadataScalar(xisf.unit, image, 'SER:LittleEndian')
  const littleEndian =
    typeof littleEndianMeta === 'boolean'
      ? littleEndianMeta
      : String(littleEndianMeta ?? 'true').toLowerCase() !== 'false'

  const frames = decodeXisfImageFramesToSer(image, frameCount, channelCount, littleEndian)
  let timestamps = getSerMetadataBigIntArray(xisf.unit, image, 'SER:FrameTimestamps')
  if (timestamps.length > 0 && timestamps.length !== frameCount) {
    if (strictValidation) {
      throw new SERConversionError(
        `XISF SER:FrameTimestamps length mismatch: expected ${frameCount}, got ${timestamps.length}`,
      )
    }
    emitConversionWarning(
      options,
      'xisf_timestamp_length_mismatch',
      `SER:FrameTimestamps length mismatch: expected ${frameCount}, got ${timestamps.length}; truncating`,
    )
    timestamps = timestamps.slice(0, frameCount)
  }

  const luId = Number(toBigInt(getSerMetadataScalar(xisf.unit, image, 'SER:LuID')) ?? 0n)
  const observer = String(getSerMetadataScalar(xisf.unit, image, 'SER:Observer') ?? '')
  const instrument = String(getSerMetadataScalar(xisf.unit, image, 'SER:Instrument') ?? '')
  const telescope = String(getSerMetadataScalar(xisf.unit, image, 'SER:Telescope') ?? '')
  const startTime = toBigInt(getSerMetadataScalar(xisf.unit, image, 'SER:StartTime')) ?? 0n
  const startTimeUtc =
    toBigInt(getSerMetadataScalar(xisf.unit, image, 'SER:StartTimeUTC')) ?? startTime

  return writeSER(
    {
      header: {
        colorId: color,
        width,
        height,
        pixelDepth,
        frameCount,
        littleEndian,
        luId,
        observer,
        instrument,
        telescope,
        startTime,
        startTimeUtc,
      },
      frames,
      timestamps: timestamps.length > 0 ? timestamps : undefined,
    },
    {
      strictValidation,
      endiannessPolicy: options?.endiannessPolicy === 'spec' ? 'spec' : 'compat',
      onWarning: options?.onWarning,
    },
  )
}
