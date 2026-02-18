import type {
  XISFColorFilterArray,
  XISFDisplayFunction,
  XISFFITSKeyword,
  XISFImage,
  XISFRGBWorkingSpace,
  XISFResolution,
} from './xisf-types'
import { XISFValidationError } from './xisf-errors'
import { getChildrenByName, getNodeName } from './xisf-xml'
import { parseDataBlockAttributes, parsePropertyElement, type ReadDataBlock } from './xisf-property'
import { parseTableElement } from './xisf-table'

const SAMPLE_FORMATS = new Set([
  'UInt8',
  'UInt16',
  'UInt32',
  'UInt64',
  'Float32',
  'Float64',
  'Complex32',
  'Complex64',
])
const COLOR_SPACES = new Set(['Gray', 'RGB', 'CIELab'])
const PIXEL_STORAGES = new Set(['Planar', 'Normal'])
const ORIENTATIONS = new Set(['0', 'flip', '90', '90;flip', '-90', '-90;flip', '180', '180;flip'])
const CFA_PATTERN = /^[0RGBWCMY]+$/

function parseNumberList(value: string): number[] {
  return value.split(':').map((part) => Number(part.trim()))
}

function parseGeometry(value: string): { dimensions: number[]; channels: number } {
  const values = parseNumberList(value)
  if (values.length < 2) {
    throw new XISFValidationError(`Invalid geometry: ${value}`)
  }
  if (values.some((n) => !Number.isFinite(n) || !Number.isInteger(n) || n <= 0)) {
    throw new XISFValidationError(`Geometry values must be positive integers: ${value}`)
  }
  const channels = values[values.length - 1]!
  const dimensions = values.slice(0, -1)
  return { dimensions, channels }
}

function parseBounds(value?: string | null): [number, number] | undefined {
  if (!value) return undefined
  const [a, b] = parseNumberList(value)
  if (a === undefined || b === undefined) return undefined
  return [a, b]
}

function parseRGBWorkingSpace(element: Element): XISFRGBWorkingSpace {
  const gamma = element.getAttribute('gamma') ?? 'sRGB'
  const x = parseNumberList(element.getAttribute('x') ?? '0:0:0') as [number, number, number]
  const y = parseNumberList(element.getAttribute('y') ?? '0:0:0') as [number, number, number]
  const Y = parseNumberList(element.getAttribute('Y') ?? '0:0:0') as [number, number, number]
  return {
    gamma,
    x,
    y,
    Y,
    name: element.getAttribute('name') ?? undefined,
  }
}

function parseDisplayFunction(element: Element): XISFDisplayFunction {
  return {
    m: parseNumberList(element.getAttribute('m') ?? '0.5:0.5:0.5:0.5') as [
      number,
      number,
      number,
      number,
    ],
    s: parseNumberList(element.getAttribute('s') ?? '0:0:0:0') as [number, number, number, number],
    h: parseNumberList(element.getAttribute('h') ?? '1:1:1:1') as [number, number, number, number],
    l: parseNumberList(element.getAttribute('l') ?? '0:0:0:0') as [number, number, number, number],
    r: parseNumberList(element.getAttribute('r') ?? '1:1:1:1') as [number, number, number, number],
    name: element.getAttribute('name') ?? undefined,
  }
}

function parseColorFilterArray(element: Element, strictValidation: boolean): XISFColorFilterArray {
  const width = Number(element.getAttribute('width') ?? '0')
  const height = Number(element.getAttribute('height') ?? '0')
  const pattern = element.getAttribute('pattern') ?? ''
  if (
    strictValidation &&
    (width <= 0 || height <= 0 || !Number.isInteger(width) || !Number.isInteger(height))
  ) {
    throw new XISFValidationError('ColorFilterArray width/height must be positive integers')
  }
  if (strictValidation && !CFA_PATTERN.test(pattern)) {
    throw new XISFValidationError('ColorFilterArray pattern contains invalid symbols')
  }
  if (strictValidation && pattern.length !== width * height) {
    throw new XISFValidationError('ColorFilterArray pattern length must equal width*height')
  }
  return {
    pattern,
    width,
    height,
    name: element.getAttribute('name') ?? undefined,
  }
}

function parseResolution(element: Element, strictValidation: boolean): XISFResolution {
  const unit = element.getAttribute('unit')
  const horizontal = Number(element.getAttribute('horizontal') ?? '72')
  const vertical = Number(element.getAttribute('vertical') ?? '72')
  if (
    strictValidation &&
    (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || horizontal <= 0 || vertical <= 0)
  ) {
    throw new XISFValidationError('Resolution horizontal/vertical must be positive numbers')
  }
  return {
    horizontal,
    vertical,
    unit: unit === 'cm' ? 'cm' : 'inch',
  }
}

function parseFITSKeyword(element: Element): XISFFITSKeyword {
  return {
    name: element.getAttribute('name') ?? '',
    value: element.getAttribute('value') ?? '',
    comment: element.getAttribute('comment') ?? '',
  }
}

export async function parseImageElement(
  element: Element,
  resolveReference: (ref: string) => Element | null,
  readDataBlock: ReadDataBlock,
  decodeImageData: boolean,
  strictValidation: boolean = true,
  isThumbnail: boolean = false,
): Promise<XISFImage> {
  const geometryRaw = element.getAttribute('geometry')
  if (!geometryRaw) {
    throw new XISFValidationError('Image element is missing geometry')
  }
  const sampleFormat = element.getAttribute('sampleFormat')
  if (!sampleFormat) {
    throw new XISFValidationError('Image element is missing sampleFormat')
  }
  if (!SAMPLE_FORMATS.has(sampleFormat)) {
    throw new XISFValidationError(`Unsupported image sampleFormat: ${sampleFormat}`)
  }

  const { dimensions, channels } = parseGeometry(geometryRaw)
  const dataBlock = parseDataBlockAttributes(element)
  if (!dataBlock) {
    throw new XISFValidationError('Image element is missing location/data block')
  }
  if (strictValidation && dataBlock.location.type === 'inline') {
    throw new XISFValidationError('Image element cannot use inline location')
  }
  const pixelStorage = element.getAttribute('pixelStorage') || 'Planar'
  if (!PIXEL_STORAGES.has(pixelStorage)) {
    throw new XISFValidationError(`Unsupported pixelStorage: ${pixelStorage}`)
  }
  const colorSpace = element.getAttribute('colorSpace') || 'Gray'
  if (!COLOR_SPACES.has(colorSpace)) {
    throw new XISFValidationError(`Unsupported colorSpace: ${colorSpace}`)
  }
  if (
    strictValidation &&
    (sampleFormat === 'Float32' || sampleFormat === 'Float64') &&
    !element.getAttribute('bounds')
  ) {
    throw new XISFValidationError('bounds is required for Float32/Float64 images')
  }
  const orientation = element.getAttribute('orientation') ?? undefined
  if (orientation && !ORIENTATIONS.has(orientation)) {
    throw new XISFValidationError(`Unsupported orientation: ${orientation}`)
  }
  const offsetRaw = element.getAttribute('offset')
  const offset = offsetRaw ? Number(offsetRaw) : undefined
  if (offset !== undefined && (!Number.isFinite(offset) || offset < 0)) {
    throw new XISFValidationError('offset must be a non-negative number')
  }
  const bounds = parseBounds(element.getAttribute('bounds'))
  if (
    bounds &&
    (!Number.isFinite(bounds[0]) || !Number.isFinite(bounds[1]) || bounds[0] >= bounds[1])
  ) {
    throw new XISFValidationError('bounds must contain two finite numbers with lower < upper')
  }
  if (isThumbnail && element.getAttribute('bounds')) {
    throw new XISFValidationError('Thumbnail must not define bounds')
  }
  if (isThumbnail && !['UInt8', 'UInt16'].includes(sampleFormat)) {
    throw new XISFValidationError('Thumbnail sampleFormat must be UInt8 or UInt16')
  }
  if (isThumbnail && !['Gray', 'RGB'].includes(colorSpace)) {
    throw new XISFValidationError('Thumbnail colorSpace must be Gray or RGB')
  }
  if (isThumbnail && dimensions.length !== 2) {
    throw new XISFValidationError('Thumbnail must be two-dimensional')
  }

  const image: XISFImage = {
    id: element.getAttribute('id') ?? undefined,
    uuid: element.getAttribute('uuid') ?? undefined,
    geometry: dimensions,
    channelCount: channels,
    sampleFormat: sampleFormat as XISFImage['sampleFormat'],
    bounds,
    imageType: element.getAttribute('imageType') ?? undefined,
    pixelStorage: pixelStorage as XISFImage['pixelStorage'],
    colorSpace: colorSpace as XISFImage['colorSpace'],
    offset,
    orientation,
    dataBlock,
    properties: [],
    tables: [],
    fitsKeywords: [],
  }

  if (decodeImageData) {
    image.data = await readDataBlock(element, dataBlock)
  }

  const children = getChildrenByName(element, 'Reference')
  const inlinedChildren = (element: Element): Element[] => {
    const all = [] as Element[]
    const local = element.childNodes
    for (let i = 0; i < local.length; i++) {
      const n = local.item(i)
      if (n && n.nodeType === 1) all.push(n as Element)
    }
    return all
  }

  const materialized: Element[] = []
  for (const child of inlinedChildren(element)) {
    if (getNodeName(child) === 'Reference') {
      const ref = child.getAttribute('ref')
      if (ref) {
        const target = resolveReference(ref)
        if (target) {
          if (strictValidation && getNodeName(target) === 'Reference') {
            throw new XISFValidationError(`Chained references are not allowed (${ref})`)
          }
          materialized.push(target)
        }
      }
      continue
    }
    materialized.push(child)
  }
  for (const refElement of children) {
    const ref = refElement.getAttribute('ref')
    if (!ref) continue
    const target = resolveReference(ref)
    if (strictValidation && target && getNodeName(target) === 'Reference') {
      throw new XISFValidationError(`Chained references are not allowed (${ref})`)
    }
    if (target && !materialized.includes(target)) {
      materialized.push(target)
    }
  }

  for (const child of materialized) {
    const name = getNodeName(child)
    switch (name) {
      case 'Property':
        image.properties.push(
          await parsePropertyElement(child, readDataBlock, { strictValidation }),
        )
        break
      case 'Table':
        image.tables.push(
          await parseTableElement(child, resolveReference, readDataBlock, { strictValidation }),
        )
        break
      case 'FITSKeyword':
        image.fitsKeywords.push(parseFITSKeyword(child))
        break
      case 'ICCProfile': {
        if (strictValidation && child.hasAttribute('byteOrder')) {
          throw new XISFValidationError('ICCProfile must not define byteOrder')
        }
        const block = parseDataBlockAttributes(child)
        if (block) {
          image.iccProfile = await readDataBlock(child, block)
        }
        break
      }
      case 'RGBWorkingSpace':
        image.rgbWorkingSpace = parseRGBWorkingSpace(child)
        break
      case 'DisplayFunction':
        image.displayFunction = parseDisplayFunction(child)
        break
      case 'ColorFilterArray':
        if (isThumbnail) {
          throw new XISFValidationError('Thumbnail must not contain ColorFilterArray')
        }
        image.colorFilterArray = parseColorFilterArray(child, strictValidation)
        break
      case 'Resolution':
        image.resolution = parseResolution(child, strictValidation)
        break
      case 'Thumbnail':
        if (isThumbnail) {
          throw new XISFValidationError('Nested Thumbnail elements are not allowed')
        }
        image.thumbnail = await parseImageElement(
          child,
          resolveReference,
          readDataBlock,
          decodeImageData,
          strictValidation,
          true,
        )
        break
      default:
        break
    }
  }

  return image
}
