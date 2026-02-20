import type { XISFDataBlock, XISFProperty } from './xisf-types'
import {
  parseChecksumSpec,
  parseCompressionSpec,
  parseCompressionSubblocks,
  parseXISFLocation,
} from './xisf-location'
import { getFirstChildByName } from './xisf-xml'
import { XISFValidationError } from './xisf-errors'

export type ReadDataBlock = (element: Element, block: XISFDataBlock) => Promise<Uint8Array>
export interface ParsePropertyOptions {
  strictValidation?: boolean
  defaultType?: string
  defaultId?: string
  defaultFormat?: string
}

type ScalarType =
  | 'Boolean'
  | 'Int8'
  | 'UInt8'
  | 'Int16'
  | 'UInt16'
  | 'Int32'
  | 'UInt32'
  | 'Int64'
  | 'UInt64'
  | 'Float32'
  | 'Float64'
  | 'Complex32'
  | 'Complex64'
  | 'String'
  | 'TimePoint'

const SCALAR_ALIASES: Record<string, ScalarType> = {
  Boolean: 'Boolean',
  Int8: 'Int8',
  UInt8: 'UInt8',
  Byte: 'UInt8',
  Int16: 'Int16',
  UInt16: 'UInt16',
  Short: 'Int16',
  UShort: 'UInt16',
  Int32: 'Int32',
  UInt32: 'UInt32',
  Int: 'Int32',
  UInt: 'UInt32',
  Int64: 'Int64',
  UInt64: 'UInt64',
  Float32: 'Float32',
  Float: 'Float32',
  Float64: 'Float64',
  Double: 'Float64',
  Complex32: 'Complex32',
  Complex64: 'Complex64',
  String: 'String',
  TimePoint: 'TimePoint',
}

const VECTOR_BASE: Record<string, ScalarType> = {
  I8Vector: 'Int8',
  UI8Vector: 'UInt8',
  ByteArray: 'UInt8',
  I16Vector: 'Int16',
  UI16Vector: 'UInt16',
  I32Vector: 'Int32',
  UI32Vector: 'UInt32',
  I64Vector: 'Int64',
  UI64Vector: 'UInt64',
  IVector: 'Int32',
  UIVector: 'UInt32',
  F32Vector: 'Float32',
  F64Vector: 'Float64',
  Vector: 'Float64',
  C32Vector: 'Complex32',
  C64Vector: 'Complex64',
}

const MATRIX_BASE: Record<string, ScalarType> = {
  I8Matrix: 'Int8',
  UI8Matrix: 'UInt8',
  ByteMatrix: 'UInt8',
  I16Matrix: 'Int16',
  UI16Matrix: 'UInt16',
  I32Matrix: 'Int32',
  UI32Matrix: 'UInt32',
  I64Matrix: 'Int64',
  UI64Matrix: 'UInt64',
  IMatrix: 'Int32',
  UIMatrix: 'UInt32',
  F32Matrix: 'Float32',
  F64Matrix: 'Float64',
  Matrix: 'Float64',
  C32Matrix: 'Complex32',
  C64Matrix: 'Complex64',
}

function normalizeScalarType(type: string): ScalarType | undefined {
  return SCALAR_ALIASES[type]
}

function parseBoolean(value: string): boolean {
  const lowered = value.toLowerCase()
  return lowered === 'true' || lowered === '1'
}

function parseComplexText(raw: string): { real: number; imag: number } {
  const normalized = raw.trim().replace(',', ':')
  const idx = normalized.indexOf(':')
  if (idx > 0) {
    return {
      real: Number.parseFloat(normalized.slice(0, idx)),
      imag: Number.parseFloat(normalized.slice(idx + 1)),
    }
  }
  return { real: Number.parseFloat(normalized), imag: 0 }
}

function parseScalarValue(
  type: string,
  raw: string,
): string | number | boolean | bigint | Record<string, unknown> {
  const normalized = normalizeScalarType(type) ?? type
  switch (normalized) {
    case 'Boolean':
      return parseBoolean(raw)
    case 'Int8':
    case 'Int16':
    case 'Int32':
      return Number.parseInt(raw, 10)
    case 'UInt8':
    case 'UInt16':
    case 'UInt32':
      return Number.parseInt(raw, 10)
    case 'Int64':
    case 'UInt64':
      return BigInt(raw)
    case 'Float32':
    case 'Float64':
      return Number.parseFloat(raw)
    case 'Complex32':
    case 'Complex64':
      return parseComplexText(raw)
    case 'TimePoint':
    case 'String':
    default:
      return raw
  }
}

function dataBlockByteOrder(block: XISFDataBlock): 'little' | 'big' {
  return block.byteOrder === 'big' ? 'big' : 'little'
}

function scalarByteSize(type: ScalarType): number {
  switch (type) {
    case 'Boolean':
    case 'Int8':
    case 'UInt8':
      return 1
    case 'Int16':
    case 'UInt16':
      return 2
    case 'Int32':
    case 'UInt32':
    case 'Float32':
      return 4
    case 'Int64':
    case 'UInt64':
    case 'Float64':
      return 8
    case 'Complex32':
      return 8
    case 'Complex64':
      return 16
    case 'String':
    case 'TimePoint':
      return 1
  }
}

function decodeScalarFromBytes(
  type: ScalarType,
  bytes: Uint8Array,
  byteOrder: 'little' | 'big',
): string | number | boolean | bigint | Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const little = byteOrder === 'little'
  if (bytes.byteLength < scalarByteSize(type)) {
    throw new XISFValidationError('Property data block is shorter than required for scalar type')
  }
  switch (type) {
    case 'Boolean':
      return view.getUint8(0) !== 0
    case 'Int8':
      return view.getInt8(0)
    case 'UInt8':
      return view.getUint8(0)
    case 'Int16':
      return view.getInt16(0, little)
    case 'UInt16':
      return view.getUint16(0, little)
    case 'Int32':
      return view.getInt32(0, little)
    case 'UInt32':
      return view.getUint32(0, little)
    case 'Int64':
      return view.getBigInt64(0, little)
    case 'UInt64':
      return view.getBigUint64(0, little)
    case 'Float32':
      return view.getFloat32(0, little)
    case 'Float64':
      return view.getFloat64(0, little)
    case 'Complex32':
      return {
        real: view.getFloat32(0, little),
        imag: view.getFloat32(4, little),
      }
    case 'Complex64':
      return {
        real: view.getFloat64(0, little),
        imag: view.getFloat64(8, little),
      }
    case 'String':
    case 'TimePoint':
      return new TextDecoder('utf-8').decode(bytes)
  }
}

function decodePrimitiveArray(
  type: ScalarType,
  bytes: Uint8Array,
  byteOrder: 'little' | 'big',
  length?: number,
): ArrayLike<number | bigint> {
  const little = byteOrder === 'little'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const itemSize = scalarByteSize(type)
  const count = length ?? Math.floor(bytes.byteLength / itemSize)
  switch (type) {
    case 'Int8': {
      const out = new Int8Array(count)
      for (let i = 0; i < count; i++) out[i] = view.getInt8(i)
      return out
    }
    case 'UInt8':
    case 'Boolean': {
      const out = new Uint8Array(count)
      for (let i = 0; i < count; i++) out[i] = view.getUint8(i)
      return out
    }
    case 'Int16': {
      const out = new Int16Array(count)
      for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, little)
      return out
    }
    case 'UInt16': {
      const out = new Uint16Array(count)
      for (let i = 0; i < count; i++) out[i] = view.getUint16(i * 2, little)
      return out
    }
    case 'Int32': {
      const out = new Int32Array(count)
      for (let i = 0; i < count; i++) out[i] = view.getInt32(i * 4, little)
      return out
    }
    case 'UInt32': {
      const out = new Uint32Array(count)
      for (let i = 0; i < count; i++) out[i] = view.getUint32(i * 4, little)
      return out
    }
    case 'Int64': {
      const out = new BigInt64Array(count)
      for (let i = 0; i < count; i++) out[i] = view.getBigInt64(i * 8, little)
      return out
    }
    case 'UInt64': {
      const out = new BigUint64Array(count)
      for (let i = 0; i < count; i++) out[i] = view.getBigUint64(i * 8, little)
      return out
    }
    case 'Float32': {
      const out = new Float32Array(count)
      for (let i = 0; i < count; i++) out[i] = view.getFloat32(i * 4, little)
      return out
    }
    case 'Float64': {
      const out = new Float64Array(count)
      for (let i = 0; i < count; i++) out[i] = view.getFloat64(i * 8, little)
      return out
    }
    case 'Complex32': {
      const out = new Float32Array(count * 2)
      for (let i = 0; i < count; i++) {
        out[i * 2] = view.getFloat32(i * 8, little)
        out[i * 2 + 1] = view.getFloat32(i * 8 + 4, little)
      }
      return out
    }
    case 'Complex64': {
      const out = new Float64Array(count * 2)
      for (let i = 0; i < count; i++) {
        out[i * 2] = view.getFloat64(i * 16, little)
        out[i * 2 + 1] = view.getFloat64(i * 16 + 8, little)
      }
      return out
    }
    case 'String':
    case 'TimePoint':
      return new Uint8Array(bytes)
  }
}

export function parseDataBlockAttributes(element: Element): XISFDataBlock | undefined {
  const locationRaw = element.getAttribute('location')
  if (!locationRaw) return undefined

  const location = parseXISFLocation(locationRaw)
  const checksumRaw = element.getAttribute('checksum')
  const compressionRaw = element.getAttribute('compression')
  const byteOrderRaw = element.getAttribute('byteOrder')
  const subblocksRaw = element.getAttribute('subblocks')

  const dataBlock: XISFDataBlock = {
    location,
    byteOrder: byteOrderRaw === 'big' ? 'big' : byteOrderRaw === 'little' ? 'little' : undefined,
  }

  if (checksumRaw) {
    const checksum = parseChecksumSpec(checksumRaw)
    dataBlock.checksum = {
      algorithm: checksum.algorithm as never,
      digest: checksum.digest,
    }
  }

  if (compressionRaw) {
    const compression = parseCompressionSpec(compressionRaw)
    dataBlock.compression = {
      codec: compression.codec as never,
      uncompressedSize: compression.uncompressedSize,
      itemSize: compression.itemSize,
      subblocks: subblocksRaw ? parseCompressionSubblocks(subblocksRaw) : undefined,
    }
  }

  if (location.type === 'inline') {
    dataBlock.inlineData = (element.textContent ?? '').trim()
  } else if (location.type === 'embedded') {
    const dataElement = getFirstChildByName(element, 'Data')
    if (dataElement) {
      const encoding = dataElement.getAttribute('encoding')
      if (encoding === 'base64' || encoding === 'hex') {
        location.encoding = encoding
      }
      dataBlock.embeddedData = (dataElement.textContent ?? '').trim()
      if (!dataBlock.compression) {
        const embeddedCompressionRaw = dataElement.getAttribute('compression')
        if (embeddedCompressionRaw) {
          const compression = parseCompressionSpec(embeddedCompressionRaw)
          dataBlock.compression = {
            codec: compression.codec as never,
            uncompressedSize: compression.uncompressedSize,
            itemSize: compression.itemSize,
            subblocks: dataElement.getAttribute('subblocks')
              ? parseCompressionSubblocks(dataElement.getAttribute('subblocks')!)
              : undefined,
          }
        }
      }
    }
  }

  return dataBlock
}

function parseVectorData(type: string, bytes: Uint8Array, length?: number): ArrayLike<number> {
  const baseType = VECTOR_BASE[type]
  if (!baseType) return new Uint8Array(bytes)
  return decodePrimitiveArray(baseType, bytes, 'little', length) as ArrayLike<number>
}

export async function parsePropertyElement(
  element: Element,
  readDataBlock: ReadDataBlock,
  options?: ParsePropertyOptions,
): Promise<XISFProperty> {
  const strict = options?.strictValidation ?? true
  const id = element.getAttribute('id') ?? options?.defaultId ?? ''
  const type = element.getAttribute('type') ?? options?.defaultType ?? ''
  const format = element.getAttribute('format') ?? options?.defaultFormat ?? undefined
  const comment = element.getAttribute('comment') ?? undefined

  if (strict && !type) {
    throw new XISFValidationError(`Property '${id || '<unnamed>'}' is missing type`)
  }

  const property: XISFProperty = { id, type, format, comment }

  const valueAttr = element.hasAttribute('value') ? element.getAttribute('value') : null
  if (valueAttr !== null) {
    property.value = parseScalarValue(type, valueAttr)
    return property
  }

  const lengthAttr = element.getAttribute('length')
  const rowsAttr = element.getAttribute('rows')
  const columnsAttr = element.getAttribute('columns')
  if (lengthAttr) property.length = Number(lengthAttr)
  if (rowsAttr) property.rows = Number(rowsAttr)
  if (columnsAttr) property.columns = Number(columnsAttr)
  if (
    strict &&
    property.length !== undefined &&
    (!Number.isInteger(property.length) || property.length < 0)
  ) {
    throw new XISFValidationError(
      `Invalid property length '${lengthAttr}' for '${id || '<unnamed>'}'`,
    )
  }
  if (
    strict &&
    property.rows !== undefined &&
    (!Number.isInteger(property.rows) || property.rows < 0)
  ) {
    throw new XISFValidationError(`Invalid property rows '${rowsAttr}' for '${id || '<unnamed>'}'`)
  }
  if (
    strict &&
    property.columns !== undefined &&
    (!Number.isInteger(property.columns) || property.columns < 0)
  ) {
    throw new XISFValidationError(
      `Invalid property columns '${columnsAttr}' for '${id || '<unnamed>'}'`,
    )
  }

  const block = parseDataBlockAttributes(element)
  if (!block) {
    if (type === 'String' || type === 'TimePoint') {
      property.value = element.textContent ?? ''
    } else if (normalizeScalarType(type) && (element.textContent ?? '').trim().length > 0) {
      property.value = parseScalarValue(type, (element.textContent ?? '').trim())
    }
    return property
  }

  property.dataBlock = block
  const data = await readDataBlock(element, block)
  const byteOrder = dataBlockByteOrder(block)

  if (type === 'String') {
    property.value = new TextDecoder('utf-8').decode(data)
    return property
  }
  if (type === 'TimePoint') {
    property.value = new TextDecoder('utf-8').decode(data)
    return property
  }

  const scalarType = normalizeScalarType(type)
  if (scalarType && scalarType !== 'String' && scalarType !== 'TimePoint') {
    property.value = decodeScalarFromBytes(scalarType, data, byteOrder)
    return property
  }

  if (
    type.endsWith('Vector') ||
    type === 'ByteArray' ||
    type === 'IVector' ||
    type === 'UIVector' ||
    type === 'Vector'
  ) {
    const baseType = VECTOR_BASE[type]
    if (!baseType) {
      property.value = parseVectorData(type, data, property.length)
      return property
    }
    property.value = decodePrimitiveArray(baseType, data, byteOrder, property.length)
    return property
  }

  if (type.endsWith('Matrix')) {
    const rows = property.rows ?? 0
    const columns = property.columns ?? 0
    const baseType = MATRIX_BASE[type]
    if (!baseType) {
      property.value = data
      return property
    }
    const itemCount = rows > 0 && columns > 0 ? rows * columns : undefined
    const arr = decodePrimitiveArray(baseType, data, byteOrder, itemCount)
    const values = Array.from(arr)
    const matrix: Array<Array<number | bigint>> = []
    for (let r = 0; r < rows; r++) {
      matrix.push(values.slice(r * columns, (r + 1) * columns))
    }
    property.value = { rows, columns, values: matrix }
    return property
  }

  property.value = data
  return property
}
