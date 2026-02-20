import {
  parseMonolithicContainer,
  isMonolithicXISF,
  extractAttachmentBytes,
} from './xisf-container'
import { parseXISFXML, getChildrenByName, getNodeName } from './xisf-xml'
import { parsePropertyElement, type ReadDataBlock } from './xisf-property'
import { parseImageElement } from './xisf-image'
import { parseTableElement } from './xisf-table'
import { DefaultXISFCodecProvider, decodeCompressedBlock } from './xisf-codec'
import { DefaultXISFResourceResolver } from './xisf-resolver'
import { parseXISFLocation, resolveHeaderRelativePath } from './xisf-location'
import { parseXISBIndex, sliceXISBBlock } from './xisb-index'
import { verifyChecksum } from './xisf-checksum'
import { hasDetachedSignature, verifyDetachedSignature } from './xisf-signature'
import { base64ToBytes } from '../core/base64'
import {
  XISFChecksumError,
  XISFParseError,
  XISFResourceError,
  XISFValidationError,
  XISFSignatureError,
} from './xisf-errors'
import type {
  XISFDataBlock,
  XISFLocation,
  XISFReadOptions,
  XISFUnit,
  XISFWarning,
  XISFProperty,
  XISFTable,
} from './xisf-types'

function withDefaults(options?: XISFReadOptions): Required<XISFReadOptions> {
  return {
    strictValidation: options?.strictValidation ?? true,
    verifyChecksums: options?.verifyChecksums ?? true,
    verifySignatures: options?.verifySignatures ?? true,
    signaturePolicy: options?.signaturePolicy ?? 'require',
    decodeImageData: options?.decodeImageData ?? true,
    baseUrl: options?.baseUrl ?? '',
    headerDir: options?.headerDir ?? '',
    onWarning: options?.onWarning ?? (() => undefined),
    codecProvider: options?.codecProvider ?? DefaultXISFCodecProvider,
    resourceResolver: options?.resourceResolver ?? DefaultXISFResourceResolver,
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function decodeInlineData(encoding: 'base64' | 'hex', payload: string): Uint8Array {
  const normalized = payload.replace(/\s+/g, '')
  if (encoding === 'base64') {
    return base64ToBytes(normalized)
  }

  const bytes = new Uint8Array(normalized.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function decodeBase64Fallback(payload: string): Uint8Array {
  return base64ToBytes(payload)
}

function warn(options: Required<XISFReadOptions>, warning: XISFWarning): void {
  options.onWarning(warning)
}

function maybeThrow(options: Required<XISFReadOptions>, error: Error, code: string): void {
  if (options.strictValidation) throw error
  warn(options, { code, message: error.message })
}

async function decodeInlineOrEmbedded(block: XISFDataBlock): Promise<Uint8Array> {
  if (block.location.type === 'inline') {
    if (block.location.encoding === 'base64') {
      return decodeBase64Fallback(block.inlineData ?? '')
    }
    return decodeInlineData('hex', block.inlineData ?? '')
  }
  if (block.location.type === 'embedded') {
    const encoding = block.location.encoding ?? 'base64'
    if (encoding === 'base64') {
      return decodeBase64Fallback(block.embeddedData ?? '')
    }
    return decodeInlineData('hex', block.embeddedData ?? '')
  }
  throw new XISFParseError('decodeInlineOrEmbedded called on non-inline block')
}

export class XISF {
  readonly unit: XISFUnit

  private constructor(unit: XISFUnit) {
    this.unit = unit
  }

  static async fromArrayBuffer(buffer: ArrayBuffer, options?: XISFReadOptions): Promise<XISF> {
    const readOptions = withDefaults(options)
    if (!readOptions.verifySignatures && readOptions.signaturePolicy === 'require') {
      throw new XISFSignatureError('signaturePolicy=require requires verifySignatures=true')
    }

    let headerXml = ''
    let monolithicBuffer: ArrayBuffer | undefined

    if (isMonolithicXISF(buffer)) {
      const container = parseMonolithicContainer(buffer)
      headerXml = container.headerXml
      monolithicBuffer = buffer
    } else {
      headerXml = new TextDecoder('utf-8').decode(new Uint8Array(buffer))
    }

    const doc = parseXISFXML(headerXml)
    const detachedSignaturePresent = hasDetachedSignature(doc)
    const root = doc.documentElement
    const forceSignedChecksumValidation =
      detachedSignaturePresent &&
      readOptions.verifySignatures &&
      readOptions.signaturePolicy !== 'ignore'

    const byUid = new Map<string, Element>()
    for (let i = 0; i < root.childNodes.length; i++) {
      const node = root.childNodes.item(i)
      if (!node || node.nodeType !== 1) continue
      const element = node as Element
      const uid = element.getAttribute('uid')
      if (uid) {
        byUid.set(uid, element)
      }
    }

    const resolveReference = (ref: string): Element | null => byUid.get(ref) ?? null

    const readDataBlock: ReadDataBlock = async (element, block): Promise<Uint8Array> => {
      let raw: Uint8Array
      const location = block.location

      if (location.type === 'inline' || location.type === 'embedded') {
        raw = await decodeInlineOrEmbedded(block)
      } else if (location.type === 'attachment') {
        if (!monolithicBuffer) {
          throw new XISFResourceError(
            'Attachment location found but no monolithic XISF payload exists',
          )
        }
        raw = extractAttachmentBytes(monolithicBuffer, location.position, location.size)
      } else {
        raw = await XISF.resolveExternalLocation(location, readOptions)
      }

      const isExternalOrAttached =
        location.type === 'attachment' || location.type === 'url' || location.type === 'path'
      if (forceSignedChecksumValidation && isExternalOrAttached && !block.checksum) {
        maybeThrow(
          readOptions,
          new XISFChecksumError(`Checksum is required for signed block in ${element.tagName}`),
          'checksum_required_for_signed_block',
        )
      }

      if (block.checksum && (readOptions.verifyChecksums || forceSignedChecksumValidation)) {
        const ok = await verifyChecksum(raw, block.checksum)
        if (!ok) {
          maybeThrow(
            readOptions,
            new XISFChecksumError(`Checksum mismatch for ${element.tagName}`),
            'checksum_mismatch',
          )
        }
      }

      if (block.compression) {
        try {
          raw = decodeCompressedBlock(raw, block.compression, readOptions.codecProvider)
        } catch (error) {
          maybeThrow(readOptions, error as Error, 'decompression_failed')
        }
      }

      return raw
    }

    const metadataProperties: XISFProperty[] = []
    const standaloneProperties: XISFProperty[] = []
    const standaloneTables: XISFTable[] = []

    const metadataElement = getChildrenByName(root, 'Metadata')[0]
    if (metadataElement) {
      const properties = getChildrenByName(metadataElement, 'Property')
      for (const propertyNode of properties) {
        metadataProperties.push(
          await parsePropertyElement(propertyNode, readDataBlock, {
            strictValidation: readOptions.strictValidation,
          }),
        )
      }
    }

    const images = []
    for (const imageNode of getChildrenByName(root, 'Image')) {
      const image = await parseImageElement(
        imageNode,
        resolveReference,
        readDataBlock,
        readOptions.decodeImageData,
        readOptions.strictValidation,
      )
      images.push(image)
    }

    for (let i = 0; i < root.childNodes.length; i++) {
      const node = root.childNodes.item(i)
      if (!node || node.nodeType !== 1) continue
      const element = node as Element
      const name = getNodeName(element)
      if (name === 'Property') {
        standaloneProperties.push(
          await parsePropertyElement(element, readDataBlock, {
            strictValidation: readOptions.strictValidation,
          }),
        )
      } else if (name === 'Table') {
        standaloneTables.push(
          await parseTableElement(element, resolveReference, readDataBlock, {
            strictValidation: readOptions.strictValidation,
          }),
        )
      }
    }

    let signatureResult = { present: false, verified: true } as XISFUnit['signature']
    if (detachedSignaturePresent && readOptions.signaturePolicy === 'ignore') {
      signatureResult = {
        present: true,
        verified: false,
        reason: 'Signature verification skipped by signaturePolicy=ignore',
      }
    } else if (readOptions.verifySignatures) {
      signatureResult = await verifyDetachedSignature(doc)
      if (signatureResult.present && !signatureResult.verified) {
        if (readOptions.signaturePolicy === 'require') {
          throw new XISFSignatureError(signatureResult.reason ?? 'Signature verification failed')
        }
        warn(readOptions, {
          code: 'signature_verification_failed',
          message: signatureResult.reason ?? 'Signature verification failed',
        })
      }
    }

    return new XISF({
      metadata: metadataProperties,
      images,
      standaloneProperties,
      standaloneTables,
      version: root.getAttribute('version') ?? '1.0',
      signature: signatureResult,
    })
  }

  static async fromBlob(blob: Blob, options?: XISFReadOptions): Promise<XISF> {
    const buffer = await blob.arrayBuffer()
    return XISF.fromArrayBuffer(buffer, options)
  }

  static async fromURL(url: string, options?: XISFReadOptions): Promise<XISF> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new XISFResourceError(
        `Failed to fetch XISF file: ${response.status} ${response.statusText}`,
      )
    }
    const buffer = await response.arrayBuffer()

    const headerDir = options?.headerDir ?? XISF.deriveHeaderDirFromURL(url)
    return XISF.fromArrayBuffer(buffer, {
      ...options,
      baseUrl: options?.baseUrl ?? url,
      headerDir,
    })
  }

  static fromNodeBuffer(
    nodeBuffer: { buffer: ArrayBuffer; byteOffset: number; byteLength: number },
    options?: XISFReadOptions,
  ): Promise<XISF> {
    const buffer = nodeBuffer.buffer.slice(
      nodeBuffer.byteOffset,
      nodeBuffer.byteOffset + nodeBuffer.byteLength,
    )
    return XISF.fromArrayBuffer(buffer, options)
  }

  getImage(index: number = 0) {
    return this.unit.images[index]
  }

  getMetadata(): XISFProperty[] {
    return this.unit.metadata
  }

  private static async resolveExternalLocation(
    location: Extract<XISFLocation, { type: 'url' | 'path' }>,
    options: Required<XISFReadOptions>,
  ): Promise<Uint8Array> {
    if (location.type === 'url') {
      const data = await options.resourceResolver.resolveURL(location.url)
      if (!location.indexId) return data
      return XISF.sliceIndexedBlock(toArrayBuffer(data), location.indexId)
    }

    const pathSpec = resolveHeaderRelativePath(location.path, options.headerDir || undefined)
    const data = await options.resourceResolver.resolvePath(pathSpec)
    if (!location.indexId) return data
    return XISF.sliceIndexedBlock(toArrayBuffer(data), location.indexId)
  }

  private static sliceIndexedBlock(buffer: ArrayBuffer, indexId: bigint): Uint8Array {
    const index = parseXISBIndex(buffer)
    const element = index.byId.get(indexId)
    if (!element) {
      throw new XISFValidationError(`Missing XISB block for indexId ${indexId.toString(16)}`)
    }
    return sliceXISBBlock(buffer, element)
  }

  private static deriveHeaderDirFromURL(url: string): string {
    try {
      const parsed = new URL(url)
      const path = parsed.pathname
      const slash = path.lastIndexOf('/')
      if (slash < 0) return ''
      const dirPath = path.slice(0, slash)
      return `${parsed.protocol}//${parsed.host}${dirPath}`
    } catch {
      return ''
    }
  }
}

export function parseXISFLocationString(location: string): XISFLocation {
  return parseXISFLocation(location)
}
