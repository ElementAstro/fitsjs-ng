import { buildMonolithicContainer } from './xisf-container'
import { buildXISBFile } from './xisb-index'
import { createDocument, serializeXML } from './xisf-xml'
import { DefaultXISFCodecProvider, encodeCompressedBlock } from './xisf-codec'
import { computeChecksum } from './xisf-checksum'
import type { XISFImage, XISFProperty, XISFTable, XISFUnit, XISFWriteOptions } from './xisf-types'
import { XISFValidationError } from './xisf-errors'

interface PendingAttachment {
  element: Element
  data: Uint8Array
}

interface DistributedBlockRef {
  element: Element
  data: Uint8Array
}

type PropertyScalarType =
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

const PROPERTY_VECTOR_BASE: Record<string, PropertyScalarType> = {
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

const PROPERTY_MATRIX_BASE: Record<string, PropertyScalarType> = {
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

const IMAGE_SAMPLE_FORMATS = new Set([
  'UInt8',
  'UInt16',
  'UInt32',
  'UInt64',
  'Float32',
  'Float64',
  'Complex32',
  'Complex64',
])
const IMAGE_COLOR_SPACES = new Set(['Gray', 'RGB', 'CIELab'])
const IMAGE_PIXEL_STORAGES = new Set(['Planar', 'Normal'])

function withDefaults(options?: XISFWriteOptions): Required<XISFWriteOptions> {
  return {
    strictValidation: options?.strictValidation ?? true,
    blockAlignment: options?.blockAlignment ?? 4096,
    maxInlineBlockSize: options?.maxInlineBlockSize ?? 3072,
    compression: options?.compression ?? null,
    compressionLevel: options?.compressionLevel ?? 0,
    checksumAlgorithm: options?.checksumAlgorithm ?? 'sha1',
    codecProvider: options?.codecProvider ?? DefaultXISFCodecProvider,
  }
}

function parseScalarValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'bigint') return value.toString(10)
  return String(value)
}

function scalarByteSize(type: PropertyScalarType): number {
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
  }
}

function imageSampleByteSize(sampleFormat: XISFImage['sampleFormat']): number {
  switch (sampleFormat) {
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

function propertyByteOrderRelevant(type: string): boolean {
  const base = PROPERTY_VECTOR_BASE[type] ?? PROPERTY_MATRIX_BASE[type]
  if (base) return scalarByteSize(base) > 1
  return false
}

function setScalar(
  view: DataView,
  type: PropertyScalarType,
  offset: number,
  value: number | bigint,
  little: boolean,
): void {
  switch (type) {
    case 'Boolean':
    case 'UInt8':
      view.setUint8(offset, Number(value))
      break
    case 'Int8':
      view.setInt8(offset, Number(value))
      break
    case 'Int16':
      view.setInt16(offset, Number(value), little)
      break
    case 'UInt16':
      view.setUint16(offset, Number(value), little)
      break
    case 'Int32':
      view.setInt32(offset, Number(value), little)
      break
    case 'UInt32':
      view.setUint32(offset, Number(value), little)
      break
    case 'Int64':
      view.setBigInt64(offset, BigInt(value), little)
      break
    case 'UInt64':
      view.setBigUint64(offset, BigInt(value), little)
      break
    case 'Float32':
      view.setFloat32(offset, Number(value), little)
      break
    case 'Float64':
      view.setFloat64(offset, Number(value), little)
      break
    case 'Complex32':
    case 'Complex64':
      break
  }
}

function normalizeComplexValue(value: unknown): { real: number; imag: number } {
  if (Array.isArray(value) && value.length >= 2) {
    return { real: Number(value[0]), imag: Number(value[1]) }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return {
      real: Number(record.real ?? 0),
      imag: Number(record.imag ?? 0),
    }
  }
  return { real: Number(value ?? 0), imag: 0 }
}

function flattenPropertyValue(
  value: unknown,
): Array<number | bigint | { real: number; imag: number }> {
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number | bigint>)
  }
  if (!Array.isArray(value)) {
    return []
  }
  if (value.length > 0 && Array.isArray(value[0])) {
    return (value as unknown[]).flat() as Array<number | bigint | { real: number; imag: number }>
  }
  return value as Array<number | bigint | { real: number; imag: number }>
}

function encodeStructuredPropertyValue(
  property: XISFProperty,
): { bytes: Uint8Array; itemCount: number; rows?: number; columns?: number } | undefined {
  const byteOrder = property.dataBlock?.byteOrder === 'big' ? 'big' : 'little'
  const little = byteOrder === 'little'

  const encode = (
    baseType: PropertyScalarType,
    flatValues: Array<number | bigint | { real: number; imag: number }>,
  ): Uint8Array => {
    if (baseType === 'Complex32' || baseType === 'Complex64') {
      const componentSize = baseType === 'Complex32' ? 4 : 8
      const out = new Uint8Array(flatValues.length * componentSize * 2)
      const view = new DataView(out.buffer)
      for (let i = 0; i < flatValues.length; i++) {
        const complex = normalizeComplexValue(flatValues[i])
        const baseOffset = i * componentSize * 2
        if (baseType === 'Complex32') {
          view.setFloat32(baseOffset, complex.real, little)
          view.setFloat32(baseOffset + 4, complex.imag, little)
        } else {
          view.setFloat64(baseOffset, complex.real, little)
          view.setFloat64(baseOffset + 8, complex.imag, little)
        }
      }
      return out
    }
    const out = new Uint8Array(flatValues.length * scalarByteSize(baseType))
    const view = new DataView(out.buffer)
    const itemSize = scalarByteSize(baseType)
    for (let i = 0; i < flatValues.length; i++) {
      setScalar(view, baseType, i * itemSize, flatValues[i] as number | bigint, little)
    }
    return out
  }

  const vectorBase = PROPERTY_VECTOR_BASE[property.type]
  if (vectorBase) {
    const flat = flattenPropertyValue(property.value)
    return {
      bytes: encode(vectorBase, flat),
      itemCount: flat.length,
    }
  }

  const matrixBase = PROPERTY_MATRIX_BASE[property.type]
  if (matrixBase) {
    const matrixLike = property.value as
      | { rows?: number; columns?: number; values?: unknown }
      | undefined
    const rows = property.rows ?? matrixLike?.rows
    const columns = property.columns ?? matrixLike?.columns
    const rawValues = matrixLike?.values ?? property.value
    const flat = flattenPropertyValue(rawValues)
    return {
      bytes: encode(matrixBase, flat),
      itemCount: flat.length,
      rows,
      columns,
    }
  }

  return undefined
}

function validateImageForWrite(image: XISFImage, strictValidation: boolean): void {
  if (!IMAGE_SAMPLE_FORMATS.has(image.sampleFormat)) {
    throw new XISFValidationError(`Unsupported image sampleFormat: ${image.sampleFormat}`)
  }
  if (!IMAGE_COLOR_SPACES.has(image.colorSpace ?? 'Gray')) {
    throw new XISFValidationError(`Unsupported image colorSpace: ${image.colorSpace}`)
  }
  if (!IMAGE_PIXEL_STORAGES.has(image.pixelStorage ?? 'Planar')) {
    throw new XISFValidationError(`Unsupported image pixelStorage: ${image.pixelStorage}`)
  }
  if (image.geometry.length === 0 || image.geometry.some((d) => !Number.isInteger(d) || d <= 0)) {
    throw new XISFValidationError('Image geometry must contain positive integers')
  }
  if (!Number.isInteger(image.channelCount) || image.channelCount <= 0) {
    throw new XISFValidationError('Image channelCount must be a positive integer')
  }
  if (
    strictValidation &&
    (image.sampleFormat === 'Float32' || image.sampleFormat === 'Float64') &&
    !image.bounds
  ) {
    throw new XISFValidationError('bounds is required for Float32/Float64 images')
  }
}

async function maybeApplyCompressionAndChecksum(
  data: Uint8Array,
  element: Element,
  options: Required<XISFWriteOptions>,
  itemSize: number,
): Promise<Uint8Array> {
  let out = data
  if (options.compression) {
    const compressed = encodeCompressedBlock(
      out,
      options.compression,
      options.codecProvider,
      options.compressionLevel,
      itemSize,
    )
    out = compressed.data
    const spec = compressed.spec
    const compressionAttr = spec.itemSize
      ? `${spec.codec}:${spec.uncompressedSize}:${spec.itemSize}`
      : `${spec.codec}:${spec.uncompressedSize}`
    element.setAttribute('compression', compressionAttr)
  }

  if (options.checksumAlgorithm) {
    const digest = await computeChecksum(out, options.checksumAlgorithm)
    element.setAttribute('checksum', `${options.checksumAlgorithm}:${digest}`)
  }

  return out
}

function appendPropertyElement(
  doc: Document,
  parent: Element,
  property: XISFProperty,
  pendingAttachments: PendingAttachment[],
  maxInlineSize: number,
): void {
  const element = doc.createElement('Property')
  element.setAttribute('id', property.id)
  element.setAttribute('type', property.type)
  if (property.format) element.setAttribute('format', property.format)
  if (property.comment) element.setAttribute('comment', property.comment)

  const value = property.value
  if (value === undefined || value === null) {
    // no-op
  } else if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    if (property.type === 'String' && typeof value === 'string' && value.length > maxInlineSize) {
      const bytes = new TextEncoder().encode(String(value))
      element.setAttribute('location', `attachment:0:${bytes.byteLength}`)
      pendingAttachments.push({ element, data: bytes })
    } else if (property.type === 'String' && !property.dataBlock) {
      element.appendChild(doc.createTextNode(String(value)))
    } else {
      element.setAttribute('value', parseScalarValue(value))
    }
  } else if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    if (bytes.byteLength <= maxInlineSize) {
      element.setAttribute(
        'length',
        String((value as ArrayLike<number>).length ?? bytes.byteLength),
      )
      element.setAttribute('location', 'inline:base64')
      element.appendChild(doc.createTextNode(encodeBase64(bytes)))
    } else {
      element.setAttribute(
        'length',
        String((value as ArrayLike<number>).length ?? bytes.byteLength),
      )
      element.setAttribute('location', `attachment:0:${bytes.byteLength}`)
      pendingAttachments.push({ element, data: bytes })
    }
    if (propertyByteOrderRelevant(property.type) && property.dataBlock?.byteOrder) {
      element.setAttribute('byteOrder', property.dataBlock.byteOrder)
    }
  } else {
    const encoded = encodeStructuredPropertyValue(property)
    if (encoded) {
      if (encoded.rows !== undefined) element.setAttribute('rows', String(encoded.rows))
      if (encoded.columns !== undefined) element.setAttribute('columns', String(encoded.columns))
      if (property.type in PROPERTY_VECTOR_BASE) {
        element.setAttribute('length', String(encoded.itemCount))
      }
      if (encoded.bytes.byteLength <= maxInlineSize) {
        element.setAttribute('location', 'inline:base64')
        element.appendChild(doc.createTextNode(encodeBase64(encoded.bytes)))
      } else {
        element.setAttribute('location', `attachment:0:${encoded.bytes.byteLength}`)
        pendingAttachments.push({ element, data: encoded.bytes })
      }
      if (propertyByteOrderRelevant(property.type) && property.dataBlock?.byteOrder) {
        element.setAttribute('byteOrder', property.dataBlock.byteOrder)
      }
    }
  }

  if (property.rows !== undefined) element.setAttribute('rows', String(property.rows))
  if (property.columns !== undefined) element.setAttribute('columns', String(property.columns))

  parent.appendChild(element)
}

function appendTableElement(
  doc: Document,
  parent: Element,
  table: XISFTable,
  pendingAttachments: PendingAttachment[],
  maxInlineSize: number,
): void {
  const tableElement = doc.createElement('Table')
  tableElement.setAttribute('id', table.id)
  if (table.caption) tableElement.setAttribute('caption', table.caption)
  if (table.comment) tableElement.setAttribute('comment', table.comment)
  tableElement.setAttribute('rows', String(table.dataRows.length))
  tableElement.setAttribute('columns', String(table.structure.length))

  const structureElement = doc.createElement('Structure')
  for (const field of table.structure) {
    const fieldElement = doc.createElement('Field')
    fieldElement.setAttribute('id', field.id)
    fieldElement.setAttribute('type', field.type)
    if (field.format) fieldElement.setAttribute('format', field.format)
    if (field.header) fieldElement.setAttribute('header', field.header)
    structureElement.appendChild(fieldElement)
  }
  tableElement.appendChild(structureElement)

  for (const row of table.dataRows) {
    const rowElement = doc.createElement('Row')
    for (let i = 0; i < row.cells.length; i++) {
      const cell = row.cells[i]!
      const field = table.structure[i]
      const cellElement = doc.createElement('Cell')
      const type = cell.type || field?.type
      if (type) cellElement.setAttribute('type', type)
      if (cell.id || field?.id) cellElement.setAttribute('id', cell.id || field!.id)
      if (cell.format || field?.format)
        cellElement.setAttribute('format', cell.format || field!.format!)
      if (cell.comment) cellElement.setAttribute('comment', cell.comment)
      if (cell.value !== undefined && cell.value !== null) {
        if (
          typeof cell.value === 'string' ||
          typeof cell.value === 'number' ||
          typeof cell.value === 'boolean' ||
          typeof cell.value === 'bigint'
        ) {
          cellElement.setAttribute('value', parseScalarValue(cell.value))
        } else if (ArrayBuffer.isView(cell.value)) {
          const bytes = new Uint8Array(
            cell.value.buffer,
            cell.value.byteOffset,
            cell.value.byteLength,
          )
          if (bytes.byteLength <= maxInlineSize) {
            cellElement.setAttribute('location', 'inline:base64')
            cellElement.appendChild(doc.createTextNode(encodeBase64(bytes)))
          } else {
            cellElement.setAttribute('location', `attachment:0:${bytes.byteLength}`)
            pendingAttachments.push({ element: cellElement, data: bytes })
          }
          if (type && propertyByteOrderRelevant(type) && cell.dataBlock?.byteOrder) {
            cellElement.setAttribute('byteOrder', cell.dataBlock.byteOrder)
          }
        } else if (type) {
          const encoded = encodeStructuredPropertyValue({
            ...cell,
            type,
          })
          if (encoded) {
            if (encoded.rows !== undefined) cellElement.setAttribute('rows', String(encoded.rows))
            if (encoded.columns !== undefined)
              cellElement.setAttribute('columns', String(encoded.columns))
            if (type in PROPERTY_VECTOR_BASE) {
              cellElement.setAttribute('length', String(encoded.itemCount))
            }
            if (encoded.bytes.byteLength <= maxInlineSize) {
              cellElement.setAttribute('location', 'inline:base64')
              cellElement.appendChild(doc.createTextNode(encodeBase64(encoded.bytes)))
            } else {
              cellElement.setAttribute('location', `attachment:0:${encoded.bytes.byteLength}`)
              pendingAttachments.push({ element: cellElement, data: encoded.bytes })
            }
            if (propertyByteOrderRelevant(type) && cell.dataBlock?.byteOrder) {
              cellElement.setAttribute('byteOrder', cell.dataBlock.byteOrder)
            }
          }
        }
      }
      rowElement.appendChild(cellElement)
    }
    tableElement.appendChild(rowElement)
  }

  parent.appendChild(tableElement)
}

function addImageChildren(
  doc: Document,
  imageElement: Element,
  image: XISFImage,
  pendingAttachments: PendingAttachment[],
  maxInlineSize: number,
): void {
  for (const keyword of image.fitsKeywords) {
    const node = doc.createElement('FITSKeyword')
    node.setAttribute('name', keyword.name)
    node.setAttribute('value', keyword.value)
    node.setAttribute('comment', keyword.comment)
    imageElement.appendChild(node)
  }

  for (const property of image.properties) {
    appendPropertyElement(doc, imageElement, property, pendingAttachments, maxInlineSize)
  }

  for (const table of image.tables) {
    appendTableElement(doc, imageElement, table, pendingAttachments, maxInlineSize)
  }

  if (image.iccProfile) {
    const node = doc.createElement('ICCProfile')
    node.setAttribute('location', `attachment:0:${image.iccProfile.byteLength}`)
    pendingAttachments.push({ element: node, data: image.iccProfile })
    imageElement.appendChild(node)
  }

  if (image.rgbWorkingSpace) {
    const node = doc.createElement('RGBWorkingSpace')
    node.setAttribute('gamma', image.rgbWorkingSpace.gamma)
    node.setAttribute('x', image.rgbWorkingSpace.x.join(':'))
    node.setAttribute('y', image.rgbWorkingSpace.y.join(':'))
    node.setAttribute('Y', image.rgbWorkingSpace.Y.join(':'))
    if (image.rgbWorkingSpace.name) node.setAttribute('name', image.rgbWorkingSpace.name)
    imageElement.appendChild(node)
  }

  if (image.displayFunction) {
    const node = doc.createElement('DisplayFunction')
    node.setAttribute('m', image.displayFunction.m.join(':'))
    node.setAttribute('s', image.displayFunction.s.join(':'))
    node.setAttribute('h', image.displayFunction.h.join(':'))
    node.setAttribute('l', image.displayFunction.l.join(':'))
    node.setAttribute('r', image.displayFunction.r.join(':'))
    if (image.displayFunction.name) node.setAttribute('name', image.displayFunction.name)
    imageElement.appendChild(node)
  }

  if (image.colorFilterArray) {
    const node = doc.createElement('ColorFilterArray')
    node.setAttribute('pattern', image.colorFilterArray.pattern)
    node.setAttribute('width', String(image.colorFilterArray.width))
    node.setAttribute('height', String(image.colorFilterArray.height))
    if (image.colorFilterArray.name) node.setAttribute('name', image.colorFilterArray.name)
    imageElement.appendChild(node)
  }

  if (image.resolution) {
    const node = doc.createElement('Resolution')
    node.setAttribute('horizontal', String(image.resolution.horizontal))
    node.setAttribute('vertical', String(image.resolution.vertical))
    if (image.resolution.unit) node.setAttribute('unit', image.resolution.unit)
    imageElement.appendChild(node)
  }
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
    return btoa(s)
  }

  const anyGlobal = globalThis as {
    Buffer?: { from(data: Uint8Array): { toString(encoding: 'base64'): string } }
  }
  if (anyGlobal.Buffer) {
    return anyGlobal.Buffer.from(bytes).toString('base64')
  }

  throw new XISFValidationError('No base64 encoder available in this environment')
}

async function assignAttachmentPositions(
  options: Required<XISFWriteOptions>,
  root: Element,
  attachments: PendingAttachment[],
): Promise<Array<{ position: number; data: Uint8Array }>> {
  let previousHeaderLength = -1
  let headerXml = ''
  let headerLength = 0

  while (headerLength !== previousHeaderLength) {
    const doc = root.ownerDocument
    headerXml = serializeXML(doc)
    const headerBytes = new TextEncoder().encode(headerXml)
    headerLength = headerBytes.byteLength

    if (headerLength === previousHeaderLength) break
    previousHeaderLength = headerLength
    let position = 16 + headerLength
    const aligned = (n: number): number =>
      options.blockAlignment > 1
        ? Math.ceil(n / options.blockAlignment) * options.blockAlignment
        : n

    position = aligned(position)
    for (const attachment of attachments) {
      attachment.element.setAttribute(
        'location',
        `attachment:${position}:${attachment.data.byteLength}`,
      )
      position = aligned(position + attachment.data.byteLength)
    }
  }

  const resolved: Array<{ position: number; data: Uint8Array }> = []
  for (const attachment of attachments) {
    const location = attachment.element.getAttribute('location')
    if (!location) continue
    const parts = location.split(':')
    const position = Number(parts[1])
    resolved.push({ position, data: attachment.data })
  }
  return resolved
}

export class XISFWriter {
  static async toMonolithic(unit: XISFUnit, options?: XISFWriteOptions): Promise<ArrayBuffer> {
    const writeOptions = withDefaults(options)
    const doc = createDocument()
    const root = doc.documentElement

    const metadataElement = doc.createElement('Metadata')
    const attachments: PendingAttachment[] = []

    for (const property of unit.metadata) {
      appendPropertyElement(
        doc,
        metadataElement,
        property,
        attachments,
        writeOptions.maxInlineBlockSize,
      )
    }
    root.appendChild(metadataElement)

    for (const standaloneProperty of unit.standaloneProperties) {
      appendPropertyElement(
        doc,
        root,
        standaloneProperty,
        attachments,
        writeOptions.maxInlineBlockSize,
      )
    }

    for (const standaloneTable of unit.standaloneTables) {
      appendTableElement(doc, root, standaloneTable, attachments, writeOptions.maxInlineBlockSize)
    }

    for (const image of unit.images) {
      validateImageForWrite(image, writeOptions.strictValidation)
      if (!image.data) {
        throw new XISFValidationError('Image data is required for monolithic writing')
      }

      const imageElement = doc.createElement('Image')
      imageElement.setAttribute('geometry', [...image.geometry, image.channelCount].join(':'))
      imageElement.setAttribute('sampleFormat', image.sampleFormat)
      imageElement.setAttribute('colorSpace', image.colorSpace ?? 'Gray')
      imageElement.setAttribute('pixelStorage', image.pixelStorage ?? 'Planar')
      if (image.bounds) imageElement.setAttribute('bounds', `${image.bounds[0]}:${image.bounds[1]}`)
      if (image.id) imageElement.setAttribute('id', image.id)
      if (image.uuid) imageElement.setAttribute('uuid', image.uuid)
      if (image.imageType) imageElement.setAttribute('imageType', image.imageType)
      if (image.offset !== undefined) imageElement.setAttribute('offset', String(image.offset))
      if (image.orientation) imageElement.setAttribute('orientation', image.orientation)
      if (image.dataBlock.byteOrder && imageSampleByteSize(image.sampleFormat) > 1) {
        imageElement.setAttribute('byteOrder', image.dataBlock.byteOrder)
      }

      const itemSize = imageSampleByteSize(image.sampleFormat)
      const storedData = await maybeApplyCompressionAndChecksum(
        image.data,
        imageElement,
        writeOptions,
        Math.max(1, itemSize),
      )
      imageElement.setAttribute('location', `attachment:0:${storedData.byteLength}`)
      attachments.push({ element: imageElement, data: storedData })

      addImageChildren(doc, imageElement, image, attachments, writeOptions.maxInlineBlockSize)
      root.appendChild(imageElement)
    }

    const positioned = await assignAttachmentPositions(writeOptions, root, attachments)
    const headerXml = serializeXML(doc)
    const bytes = buildMonolithicContainer(headerXml, positioned)
    return bytes.slice().buffer
  }

  static async toDistributed(
    unit: XISFUnit,
    options?: XISFWriteOptions,
  ): Promise<{ header: Uint8Array; blocks: Record<string, Uint8Array> }> {
    const writeOptions = withDefaults(options)
    const doc = createDocument()
    const root = doc.documentElement

    const blockRefs: DistributedBlockRef[] = []
    const pendingAttachments: PendingAttachment[] = []
    const metadataElement = doc.createElement('Metadata')
    root.appendChild(metadataElement)

    const attachExternalBlock = (element: Element, data: Uint8Array): void => {
      blockRefs.push({ element, data })
    }

    for (const property of unit.metadata) {
      appendPropertyElement(
        doc,
        metadataElement,
        property,
        pendingAttachments,
        writeOptions.maxInlineBlockSize,
      )
    }

    for (const standaloneProperty of unit.standaloneProperties) {
      appendPropertyElement(
        doc,
        root,
        standaloneProperty,
        pendingAttachments,
        writeOptions.maxInlineBlockSize,
      )
    }

    for (const standaloneTable of unit.standaloneTables) {
      appendTableElement(
        doc,
        root,
        standaloneTable,
        pendingAttachments,
        writeOptions.maxInlineBlockSize,
      )
    }

    for (const image of unit.images) {
      validateImageForWrite(image, writeOptions.strictValidation)
      if (!image.data) {
        throw new XISFValidationError('Image data is required for distributed writing')
      }
      const imageElement = doc.createElement('Image')
      imageElement.setAttribute('geometry', [...image.geometry, image.channelCount].join(':'))
      imageElement.setAttribute('sampleFormat', image.sampleFormat)
      imageElement.setAttribute('colorSpace', image.colorSpace ?? 'Gray')
      imageElement.setAttribute('pixelStorage', image.pixelStorage ?? 'Planar')
      if (image.bounds) imageElement.setAttribute('bounds', `${image.bounds[0]}:${image.bounds[1]}`)
      if (image.id) imageElement.setAttribute('id', image.id)
      if (image.uuid) imageElement.setAttribute('uuid', image.uuid)
      if (image.imageType) imageElement.setAttribute('imageType', image.imageType)
      if (image.offset !== undefined) imageElement.setAttribute('offset', String(image.offset))
      if (image.orientation) imageElement.setAttribute('orientation', image.orientation)
      if (image.dataBlock.byteOrder && imageSampleByteSize(image.sampleFormat) > 1) {
        imageElement.setAttribute('byteOrder', image.dataBlock.byteOrder)
      }

      const itemSize = imageSampleByteSize(image.sampleFormat)
      const storedData = await maybeApplyCompressionAndChecksum(
        image.data,
        imageElement,
        writeOptions,
        Math.max(1, itemSize),
      )
      imageElement.setAttribute('location', `attachment:0:${storedData.byteLength}`)
      pendingAttachments.push({ element: imageElement, data: storedData })

      addImageChildren(
        doc,
        imageElement,
        image,
        pendingAttachments,
        writeOptions.maxInlineBlockSize,
      )
      root.appendChild(imageElement)
    }

    for (const attachment of pendingAttachments) {
      attachExternalBlock(attachment.element, attachment.data)
    }

    const { bytes: xisbBytes, ids } = buildXISBFile(blockRefs.map((r) => r.data))
    for (let i = 0; i < blockRefs.length; i++) {
      const id = ids[i]!
      blockRefs[i]!.element.setAttribute(
        'location',
        `path(@header_dir/blocks.xisb):0x${id.toString(16)}`,
      )
    }

    const header = new TextEncoder().encode(serializeXML(doc))
    return {
      header,
      blocks: {
        'blocks.xisb': xisbBytes,
      },
    }
  }
}
