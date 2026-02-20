import type { XISFSignatureResult } from './xisf-types'
import {
  base64ToBytes,
  bytesToBase64,
  normalizeBase64 as normalizeBase64Payload,
} from '../core/base64'
import { importNodeModule } from '../core/runtime'

const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#'
const C14N_10 = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
const C14N_10_WITH_COMMENTS = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments'
const C14N_11 = 'http://www.w3.org/2006/12/xml-c14n11'
const C14N_11_WITH_COMMENTS = 'http://www.w3.org/2006/12/xml-c14n11#WithComments'
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'
const EXC_C14N_WITH_COMMENTS = 'http://www.w3.org/2001/10/xml-exc-c14n#WithComments'
const ENVELOPED_SIGNATURE = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature'
const BASE64_TRANSFORM = 'http://www.w3.org/2000/09/xmldsig#base64'

interface CanonicalizationMode {
  withComments: boolean
  exclusive: boolean
}

interface SignatureMethodSpec {
  name: string
  kind: 'rsa-pkcs1' | 'rsa-pss' | 'ecdsa'
  hash: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'
}

type TransformState = { kind: 'node'; node: Node } | { kind: 'bytes'; bytes: Uint8Array }

type LoadedPublicKey = { kind: 'node'; key: unknown } | { kind: 'webcrypto'; key: CryptoKey }

function nodeLocalName(node: Node): string {
  const value = (node as Node & { localName?: string; nodeName: string }).localName
  if (value && value.length > 0) return value
  const raw = (node as Node & { nodeName: string }).nodeName
  const idx = raw.indexOf(':')
  return idx >= 0 ? raw.slice(idx + 1) : raw
}

function isElement(node: Node | null): node is Element {
  return !!node && node.nodeType === 1
}

function isComment(node: Node | null): node is Comment {
  return !!node && node.nodeType === 8
}

function isTextLike(node: Node | null): node is Text | CDATASection {
  return !!node && (node.nodeType === 3 || node.nodeType === 4)
}

function getChildrenByLocalName(parent: Element, localName: string, namespace?: string): Element[] {
  const out: Element[] = []
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes.item(i)
    if (!isElement(child)) continue
    if (nodeLocalName(child) !== localName) continue
    if (namespace && (child.namespaceURI ?? '') !== namespace) continue
    out.push(child)
  }
  return out
}

function getFirstChildByLocalName(
  parent: Element,
  localName: string,
  namespace?: string,
): Element | null {
  const children = getChildrenByLocalName(parent, localName, namespace)
  return children.length > 0 ? children[0]! : null
}

function getDirectSignatureElement(doc: Document): Element | null {
  const root = doc.documentElement
  if (!root) return null
  for (let i = 0; i < root.childNodes.length; i++) {
    const child = root.childNodes.item(i)
    if (!isElement(child)) continue
    if (nodeLocalName(child) === 'Signature' && (child.namespaceURI ?? '') === DSIG_NS) {
      return child
    }
  }
  return null
}

export function hasDetachedSignature(doc: Document): boolean {
  return getDirectSignatureElement(doc) !== null
}

function normalizeBase64(input: string): string {
  return normalizeBase64Payload(input)
}

function toBase64Url(bytes: Uint8Array): string {
  const base64 = bytesToBase64(bytes)
  return base64.replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '')
}

async function decodeBase64(input: string): Promise<Uint8Array> {
  return base64ToBytes(normalizeBase64(input))
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength &&
    data.buffer instanceof ArrayBuffer
  ) {
    return data.buffer
  }
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#xD;')
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\t', '&#x9;')
    .replaceAll('\n', '&#xA;')
    .replaceAll('\r', '&#xD;')
}

function qName(element: Element): string {
  const prefix = element.prefix
  const local = nodeLocalName(element)
  return prefix ? `${prefix}:${local}` : local
}

function declaredNamespaces(element: Element): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes.item(i)
    if (!attr) continue
    if (attr.name === 'xmlns') {
      out.set('', attr.value)
    } else if (attr.name.startsWith('xmlns:')) {
      out.set(attr.name.slice(6), attr.value)
    }
  }
  return out
}

function copyNamespaceScope(input: Map<string, string>): Map<string, string> {
  return new Map(input.entries())
}

function removeEnvelopedSignatures(root: Node): Node {
  const clone = root.cloneNode(true)
  const walk = (node: Node): void => {
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes.item(i)
      if (!child) continue
      if (
        isElement(child) &&
        nodeLocalName(child) === 'Signature' &&
        (child.namespaceURI ?? '') === DSIG_NS
      ) {
        node.removeChild(child)
        continue
      }
      walk(child)
    }
  }
  walk(clone)
  return clone
}

function parseCanonicalizationMode(algorithm: string): CanonicalizationMode | null {
  switch (algorithm) {
    case C14N_10:
    case C14N_11:
      return { withComments: false, exclusive: false }
    case C14N_10_WITH_COMMENTS:
    case C14N_11_WITH_COMMENTS:
      return { withComments: true, exclusive: false }
    case EXC_C14N:
      return { withComments: false, exclusive: true }
    case EXC_C14N_WITH_COMMENTS:
      return { withComments: true, exclusive: true }
    default:
      return null
  }
}

function elementUsesPrefix(element: Element): string {
  return element.prefix ?? ''
}

function attributeUsesPrefix(attribute: Attr): string {
  const prefix = attribute.prefix
  if (!prefix || prefix === 'xmlns') return ''
  return prefix
}

function canonicalizeElement(
  element: Element,
  parentScope: Map<string, string>,
  mode: CanonicalizationMode,
): string {
  const elementPrefix = elementUsesPrefix(element)
  const elementNamespace = element.namespaceURI ?? ''
  const declared = declaredNamespaces(element)
  const activeScope = copyNamespaceScope(parentScope)
  for (const [prefix, uri] of declared.entries()) {
    activeScope.set(prefix, uri)
  }

  const namespacesToEmit = new Map<string, string>()
  if (mode.exclusive) {
    const usedPrefixes = new Set<string>()
    usedPrefixes.add(elementPrefix)
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes.item(i)
      if (!attr) continue
      if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue
      const attrPrefix = attributeUsesPrefix(attr)
      if (attrPrefix) usedPrefixes.add(attrPrefix)
    }
    for (const prefix of usedPrefixes) {
      const parentValue = parentScope.get(prefix) ?? ''
      const activeValue =
        prefix === elementPrefix ? elementNamespace : (activeScope.get(prefix) ?? '')
      if (activeValue !== parentValue) {
        namespacesToEmit.set(prefix, activeValue)
      }
    }
  } else {
    for (const [prefix, uri] of declared.entries()) {
      const parentValue = parentScope.get(prefix) ?? ''
      if (uri !== parentValue) {
        namespacesToEmit.set(prefix, uri)
      }
    }
    const defaultInScope = parentScope.get('') ?? ''
    if (elementPrefix === '' && elementNamespace !== defaultInScope) {
      namespacesToEmit.set('', elementNamespace)
    }
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes.item(i)
      if (!attr) continue
      if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue
      const attrPrefix = attributeUsesPrefix(attr)
      if (!attrPrefix) continue
      const parentValue = parentScope.get(attrPrefix) ?? ''
      const activeValue = activeScope.get(attrPrefix) ?? ''
      if (activeValue !== parentValue) {
        namespacesToEmit.set(attrPrefix, activeValue)
      }
    }
  }

  const namespaceAttributes = [...namespacesToEmit.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, uri]) => {
      if (prefix === '') return ` xmlns="${escapeAttribute(uri)}"`
      return ` xmlns:${prefix}="${escapeAttribute(uri)}"`
    })

  const normalAttributes: Attr[] = []
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes.item(i)
    if (!attr) continue
    if (attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue
    normalAttributes.push(attr)
  }
  normalAttributes.sort((a, b) => {
    const ans = a.namespaceURI ?? ''
    const bns = b.namespaceURI ?? ''
    if (ans === bns) {
      return nodeLocalName(a).localeCompare(nodeLocalName(b))
    }
    return ans.localeCompare(bns)
  })

  const attributesText = normalAttributes
    .map((attr) => ` ${attr.name}="${escapeAttribute(attr.value)}"`)
    .join('')

  const opening = `<${qName(element)}${namespaceAttributes.join('')}${attributesText}>`
  let body = ''
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes.item(i)
    if (!child) continue
    body += canonicalizeNode(child, activeScope, mode)
  }
  const closing = `</${qName(element)}>`
  return `${opening}${body}${closing}`
}

function canonicalizeNode(
  node: Node,
  namespaceScope: Map<string, string>,
  mode: CanonicalizationMode,
): string {
  if (node.nodeType === 9) {
    const doc = node as Document
    let out = ''
    for (let i = 0; i < doc.childNodes.length; i++) {
      const child = doc.childNodes.item(i)
      if (!child) continue
      out += canonicalizeNode(child, namespaceScope, mode)
    }
    return out
  }

  if (isElement(node)) {
    return canonicalizeElement(node, namespaceScope, mode)
  }

  if (isTextLike(node)) {
    return escapeText(node.data)
  }

  if (isComment(node)) {
    if (!mode.withComments) return ''
    return `<!--${node.data}-->`
  }

  if (node.nodeType === 7) {
    const pi = node as ProcessingInstruction
    return `<?${pi.target}${pi.data ? ` ${pi.data}` : ''}?>`
  }

  return ''
}

function canonicalize(node: Node, algorithm: string): string {
  const mode = parseCanonicalizationMode(algorithm)
  if (!mode) {
    throw new Error(`Unsupported canonicalization algorithm: ${algorithm}`)
  }
  return canonicalizeNode(node, new Map(), mode)
}

function getTransformAlgorithms(reference: Element): string[] {
  const transforms = getFirstChildByLocalName(reference, 'Transforms', DSIG_NS)
  if (!transforms) return []
  const out: string[] = []
  for (const transform of getChildrenByLocalName(transforms, 'Transform', DSIG_NS)) {
    const algorithm = transform.getAttribute('Algorithm')
    if (algorithm) out.push(algorithm)
  }
  return out
}

function findElementById(doc: Document, id: string): Element | null {
  const stack: Node[] = [doc.documentElement]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !isElement(current)) continue
    const candidate =
      current.getAttribute('Id') ??
      current.getAttribute('ID') ??
      current.getAttribute('id') ??
      current.getAttribute('xml:id') ??
      current.getAttribute('uid')
    if (candidate === id) return current
    for (let i = current.childNodes.length - 1; i >= 0; i--) {
      const child = current.childNodes.item(i)
      if (child) stack.push(child)
    }
  }
  return null
}

function resolveReferenceTarget(doc: Document, uri: string | null): TransformState {
  if (!uri || uri === '') {
    return { kind: 'node', node: doc.documentElement }
  }
  if (!uri.startsWith('#')) {
    throw new Error(`Unsupported detached reference URI: ${uri}`)
  }
  const id = decodeURIComponent(uri.slice(1))
  const target = findElementById(doc, id)
  if (!target) {
    throw new Error(`Unable to resolve signature reference URI: ${uri}`)
  }
  return { kind: 'node', node: target }
}

function readNodeText(node: Node): string {
  return (node.textContent ?? '').trim()
}

function digestAlgorithmUriToSubtle(name: string): string {
  switch (name) {
    case 'http://www.w3.org/2000/09/xmldsig#sha1':
      return 'SHA-1'
    case 'http://www.w3.org/2001/04/xmlenc#sha256':
      return 'SHA-256'
    case 'http://www.w3.org/2001/04/xmldsig-more#sha384':
      return 'SHA-384'
    case 'http://www.w3.org/2001/04/xmlenc#sha512':
      return 'SHA-512'
    default:
      throw new Error(`Unsupported digest algorithm: ${name}`)
  }
}

async function computeDigest(algorithmUri: string, data: Uint8Array): Promise<Uint8Array> {
  const subtleAlgorithm = digestAlgorithmUriToSubtle(algorithmUri)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest(subtleAlgorithm, toArrayBuffer(data))
    return new Uint8Array(digest)
  }

  const cryptoModule = await importNodeModule<{
    createHash(name: string): { update(data: Uint8Array): unknown; digest(): Uint8Array }
  }>(
    'crypto',
    `XISF signature digest ${subtleAlgorithm} without WebCrypto`,
    'Enable WebCrypto or run in Node.js for detached-signature verification.',
  )
  const hashName = subtleAlgorithm.toLowerCase().replace('-', '')
  const hash = cryptoModule.createHash(hashName)
  hash.update(data)
  return new Uint8Array(hash.digest())
}

function signatureMethodSpec(uri: string): SignatureMethodSpec {
  switch (uri) {
    case 'http://www.w3.org/2000/09/xmldsig#rsa-sha1':
      return { name: uri, kind: 'rsa-pkcs1', hash: 'SHA-1' }
    case 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256':
      return { name: uri, kind: 'rsa-pkcs1', hash: 'SHA-256' }
    case 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384':
      return { name: uri, kind: 'rsa-pkcs1', hash: 'SHA-384' }
    case 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512':
      return { name: uri, kind: 'rsa-pkcs1', hash: 'SHA-512' }
    case 'http://www.w3.org/2007/05/xmldsig-more#sha256-rsa-MGF1':
      return { name: uri, kind: 'rsa-pss', hash: 'SHA-256' }
    case 'http://www.w3.org/2007/05/xmldsig-more#sha384-rsa-MGF1':
      return { name: uri, kind: 'rsa-pss', hash: 'SHA-384' }
    case 'http://www.w3.org/2007/05/xmldsig-more#sha512-rsa-MGF1':
      return { name: uri, kind: 'rsa-pss', hash: 'SHA-512' }
    case 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256':
      return { name: uri, kind: 'ecdsa', hash: 'SHA-256' }
    case 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384':
      return { name: uri, kind: 'ecdsa', hash: 'SHA-384' }
    case 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512':
      return { name: uri, kind: 'ecdsa', hash: 'SHA-512' }
    default:
      throw new Error(`Unsupported signature method: ${uri}`)
  }
}

function trimBigEndianInteger(bytes: Uint8Array): Uint8Array {
  let first = 0
  while (first < bytes.length - 1 && bytes[first] === 0) first++
  return bytes.subarray(first)
}

async function loadNodeCryptoKeyFromKeyInfo(keyInfo: Element): Promise<unknown> {
  const cryptoModule = await importNodeModule<{
    X509Certificate: new (buffer: Uint8Array) => { publicKey: unknown }
    createPublicKey(input: { key: JsonWebKey; format: 'jwk' }): unknown
  }>(
    'crypto',
    'XISF signature key loading from KeyInfo',
    'Enable WebCrypto-compatible KeyInfo or run in Node.js for detached-signature verification.',
  )

  const x509 = getFirstChildByLocalName(keyInfo, 'X509Data', DSIG_NS)
  if (x509) {
    const certNode = getFirstChildByLocalName(x509, 'X509Certificate', DSIG_NS)
    if (certNode) {
      const certBytes = await decodeBase64(readNodeText(certNode))
      const cert = new cryptoModule.X509Certificate(certBytes)
      return cert.publicKey
    }
  }

  const keyValue = getFirstChildByLocalName(keyInfo, 'KeyValue', DSIG_NS)
  if (keyValue) {
    const rsa = getFirstChildByLocalName(keyValue, 'RSAKeyValue', DSIG_NS)
    if (rsa) {
      const modulusNode = getFirstChildByLocalName(rsa, 'Modulus', DSIG_NS)
      const exponentNode = getFirstChildByLocalName(rsa, 'Exponent', DSIG_NS)
      if (!modulusNode || !exponentNode) {
        throw new Error('Invalid RSAKeyValue: missing Modulus/Exponent')
      }
      const modulus = trimBigEndianInteger(await decodeBase64(readNodeText(modulusNode)))
      const exponent = trimBigEndianInteger(await decodeBase64(readNodeText(exponentNode)))
      const jwk: JsonWebKey = {
        kty: 'RSA',
        n: toBase64Url(modulus),
        e: toBase64Url(exponent),
      }
      return cryptoModule.createPublicKey({ key: jwk, format: 'jwk' })
    }
  }

  throw new Error('Unsupported KeyInfo content')
}

async function loadWebCryptoKeyFromKeyInfo(
  keyInfo: Element,
  method: SignatureMethodSpec,
): Promise<CryptoKey> {
  if (method.kind === 'ecdsa') {
    throw new Error('ECDSA KeyInfo import is not yet supported without SPKI')
  }

  const keyValue = getFirstChildByLocalName(keyInfo, 'KeyValue', DSIG_NS)
  if (!keyValue) {
    throw new Error('No RSA KeyValue in KeyInfo')
  }
  const rsa = getFirstChildByLocalName(keyValue, 'RSAKeyValue', DSIG_NS)
  if (!rsa) {
    throw new Error('Only RSAKeyValue is supported for WebCrypto verification')
  }
  const modulusNode = getFirstChildByLocalName(rsa, 'Modulus', DSIG_NS)
  const exponentNode = getFirstChildByLocalName(rsa, 'Exponent', DSIG_NS)
  if (!modulusNode || !exponentNode) {
    throw new Error('Invalid RSAKeyValue: missing Modulus/Exponent')
  }
  const modulus = trimBigEndianInteger(await decodeBase64(readNodeText(modulusNode)))
  const exponent = trimBigEndianInteger(await decodeBase64(readNodeText(exponentNode)))
  const jwk: JsonWebKey = {
    kty: 'RSA',
    n: toBase64Url(modulus),
    e: toBase64Url(exponent),
    ext: true,
  }
  const algorithm =
    method.kind === 'rsa-pss'
      ? { name: 'RSA-PSS', hash: method.hash }
      : { name: 'RSASSA-PKCS1-v1_5', hash: method.hash }
  return crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify'])
}

async function loadPublicKey(
  signatureElement: Element,
  method: SignatureMethodSpec,
): Promise<LoadedPublicKey> {
  const keyInfo = getFirstChildByLocalName(signatureElement, 'KeyInfo', DSIG_NS)
  if (!keyInfo) {
    throw new Error('Missing ds:KeyInfo in signature')
  }

  try {
    const key = await loadNodeCryptoKeyFromKeyInfo(keyInfo)
    return { kind: 'node', key }
  } catch (nodeError) {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const key = await loadWebCryptoKeyFromKeyInfo(keyInfo, method)
        return { kind: 'webcrypto', key }
      } catch (webError) {
        throw new Error(
          `Unable to load signature public key (node=${(nodeError as Error).message}; web=${(webError as Error).message})`,
        )
      }
    }
    throw nodeError
  }
}

function hashNameForNode(hash: SignatureMethodSpec['hash']): string {
  return hash.toLowerCase().replace('-', '')
}

function hashByteLength(hash: SignatureMethodSpec['hash']): number {
  switch (hash) {
    case 'SHA-1':
      return 20
    case 'SHA-256':
      return 32
    case 'SHA-384':
      return 48
    case 'SHA-512':
      return 64
  }
}

async function verifySignatureValue(
  signedInfoBytes: Uint8Array,
  signatureValueBytes: Uint8Array,
  method: SignatureMethodSpec,
  key: LoadedPublicKey,
): Promise<boolean> {
  if (key.kind === 'node') {
    const cryptoModule = await importNodeModule<{
      createVerify(name: string): {
        update(data: Uint8Array): unknown
        end(): unknown
        verify(key: unknown, signature: Uint8Array): boolean
        verify(
          options: { key: unknown; padding: number; saltLength: number },
          signature: Uint8Array,
        ): boolean
      }
      constants: { RSA_PKCS1_PSS_PADDING: number }
    }>(
      'crypto',
      `XISF detached signature verification (${method.name})`,
      'Enable WebCrypto or run in Node.js for detached-signature verification.',
    )
    const verifier = cryptoModule.createVerify(hashNameForNode(method.hash))
    verifier.update(signedInfoBytes)
    verifier.end()
    if (method.kind === 'rsa-pss') {
      return verifier.verify(
        {
          key: key.key,
          padding: cryptoModule.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: hashByteLength(method.hash),
        },
        signatureValueBytes,
      )
    }
    return verifier.verify(key.key, signatureValueBytes)
  }

  let algorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams
  if (method.kind === 'rsa-pss') {
    algorithm = {
      name: 'RSA-PSS',
      saltLength: hashByteLength(method.hash),
    }
  } else if (method.kind === 'ecdsa') {
    algorithm = {
      name: 'ECDSA',
      hash: method.hash,
    }
  } else {
    algorithm = {
      name: 'RSASSA-PKCS1-v1_5',
      hash: method.hash,
    }
  }
  return crypto.subtle.verify(
    algorithm,
    key.key,
    toArrayBuffer(signatureValueBytes),
    toArrayBuffer(signedInfoBytes),
  )
}

async function referenceToOctets(doc: Document, reference: Element): Promise<Uint8Array> {
  const uri = reference.getAttribute('URI')
  let state = resolveReferenceTarget(doc, uri)
  const transforms = getTransformAlgorithms(reference)

  for (const transform of transforms) {
    if (transform === ENVELOPED_SIGNATURE) {
      if (state.kind !== 'node') {
        throw new Error('Enveloped-signature transform requires XML node input')
      }
      state = { kind: 'node', node: removeEnvelopedSignatures(state.node) }
      continue
    }
    if (transform === BASE64_TRANSFORM) {
      const text =
        state.kind === 'node'
          ? readNodeText(state.node)
          : new TextDecoder('ascii').decode(state.bytes)
      state = { kind: 'bytes', bytes: await decodeBase64(text) }
      continue
    }
    if (parseCanonicalizationMode(transform)) {
      if (state.kind !== 'node') {
        throw new Error('Canonicalization transform requires XML node input')
      }
      state = { kind: 'bytes', bytes: encodeUtf8(canonicalize(state.node, transform)) }
      continue
    }
    throw new Error(`Unsupported signature transform: ${transform}`)
  }

  if (state.kind === 'bytes') return state.bytes
  return encodeUtf8(canonicalize(state.node, C14N_10))
}

async function verifyReferences(doc: Document, signedInfo: Element): Promise<void> {
  const references = getChildrenByLocalName(signedInfo, 'Reference', DSIG_NS)
  if (references.length === 0) {
    throw new Error('SignedInfo has no Reference elements')
  }

  for (const reference of references) {
    const uri = reference.getAttribute('URI') ?? ''
    const digestMethod = getFirstChildByLocalName(reference, 'DigestMethod', DSIG_NS)
    const digestValue = getFirstChildByLocalName(reference, 'DigestValue', DSIG_NS)
    if (!digestMethod || !digestValue) {
      throw new Error(`Reference ${uri} missing DigestMethod or DigestValue`)
    }
    const digestAlgorithm = digestMethod.getAttribute('Algorithm')
    if (!digestAlgorithm) {
      throw new Error(`Reference ${uri} missing DigestMethod Algorithm`)
    }
    const expectedDigest = await decodeBase64(readNodeText(digestValue))
    const referencedData = await referenceToOctets(doc, reference)
    const computedDigest = await computeDigest(digestAlgorithm, referencedData)

    if (expectedDigest.length !== computedDigest.length) {
      throw new Error(`Reference digest length mismatch for URI ${uri}`)
    }
    for (let i = 0; i < expectedDigest.length; i++) {
      if (expectedDigest[i] !== computedDigest[i]) {
        throw new Error(`Reference digest mismatch for URI ${uri}`)
      }
    }
  }
}

function normalizeResultFailure(method: string | undefined, reason: string): XISFSignatureResult {
  return {
    present: true,
    verified: false,
    algorithm: method,
    reason,
  }
}

export async function verifyDetachedSignature(doc: Document): Promise<XISFSignatureResult> {
  const signatureElement = getDirectSignatureElement(doc)
  if (!signatureElement) {
    return { present: false, verified: true }
  }

  const signedInfo = getFirstChildByLocalName(signatureElement, 'SignedInfo', DSIG_NS)
  if (!signedInfo) {
    return normalizeResultFailure(undefined, 'Signature is missing SignedInfo')
  }

  const canonicalizationMethod = getFirstChildByLocalName(
    signedInfo,
    'CanonicalizationMethod',
    DSIG_NS,
  )
  if (!canonicalizationMethod) {
    return normalizeResultFailure(undefined, 'SignedInfo is missing CanonicalizationMethod')
  }
  const canonicalizationAlgorithm = canonicalizationMethod.getAttribute('Algorithm') ?? C14N_10
  if (!parseCanonicalizationMode(canonicalizationAlgorithm)) {
    return normalizeResultFailure(
      undefined,
      `Unsupported canonicalization algorithm: ${canonicalizationAlgorithm}`,
    )
  }

  const signatureMethodElement = getFirstChildByLocalName(signedInfo, 'SignatureMethod', DSIG_NS)
  if (!signatureMethodElement) {
    return normalizeResultFailure(undefined, 'SignedInfo is missing SignatureMethod')
  }
  const signatureMethodUri = signatureMethodElement.getAttribute('Algorithm') ?? undefined
  if (!signatureMethodUri) {
    return normalizeResultFailure(undefined, 'SignatureMethod is missing Algorithm')
  }

  const signatureValueElement = getFirstChildByLocalName(
    signatureElement,
    'SignatureValue',
    DSIG_NS,
  )
  if (!signatureValueElement) {
    return normalizeResultFailure(signatureMethodUri, 'SignatureValue is missing')
  }

  let method: SignatureMethodSpec
  try {
    method = signatureMethodSpec(signatureMethodUri)
  } catch (error) {
    return normalizeResultFailure(signatureMethodUri, (error as Error).message)
  }

  try {
    await verifyReferences(doc, signedInfo)
  } catch (error) {
    return normalizeResultFailure(
      signatureMethodUri,
      `Digest verification failed: ${(error as Error).message}`,
    )
  }

  const signedInfoBytes = encodeUtf8(canonicalize(signedInfo, canonicalizationAlgorithm))
  const signatureValueBytes = await decodeBase64(readNodeText(signatureValueElement))

  let key: LoadedPublicKey
  try {
    key = await loadPublicKey(signatureElement, method)
  } catch (error) {
    return normalizeResultFailure(
      signatureMethodUri,
      `Key loading failed: ${(error as Error).message}`,
    )
  }

  let verified = false
  try {
    verified = await verifySignatureValue(signedInfoBytes, signatureValueBytes, method, key)
  } catch (error) {
    return normalizeResultFailure(
      signatureMethodUri,
      `Signature verification failed: ${(error as Error).message}`,
    )
  }

  if (!verified) {
    return normalizeResultFailure(signatureMethodUri, 'SignatureValue does not match SignedInfo')
  }

  return {
    present: true,
    verified: true,
    algorithm: method.name,
  }
}

export const __signatureTesting = {
  canonicalize,
  constants: {
    DSIG_NS,
    C14N_10,
    ENVELOPED_SIGNATURE,
    BASE64_TRANSFORM,
  },
}
