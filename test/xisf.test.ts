import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, createHash, createSign } from 'node:crypto'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { XISF } from '../src/xisf'
import { XISFWriter } from '../src/xisf-writer'
import { XISFChecksumError, XISFSignatureError, XISFValidationError } from '../src/xisf-errors'
import { buildXISBFile, parseXISBIndex, sliceXISBBlock } from '../src/xisb-index'
import { parseXISFLocation, resolveHeaderRelativePath } from '../src/xisf-location'
import { __signatureTesting } from '../src/xisf-signature'
import type { XISFUnit } from '../src/xisf-types'

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function makeSimpleUnit(data: Uint8Array): XISFUnit {
  return {
    metadata: [{ id: 'XISF:CreatorApplication', type: 'String', value: 'fitsjs-ng test' }],
    images: [
      {
        id: 'IMG0',
        geometry: [2, 2],
        channelCount: 1,
        sampleFormat: 'UInt8',
        pixelStorage: 'Planar',
        colorSpace: 'Gray',
        dataBlock: {
          location: { type: 'attachment', position: 0, size: data.byteLength },
          byteOrder: 'little',
        },
        data,
        properties: [],
        tables: [],
        fitsKeywords: [],
      },
    ],
    standaloneProperties: [],
    standaloneTables: [],
    version: '1.0',
    signature: { present: false, verified: true },
  }
}

function base64UrlToBase64(input: string): string {
  const padded = input.padEnd(Math.ceil(input.length / 4) * 4, '=')
  return padded.replaceAll('-', '+').replaceAll('_', '/')
}

function firstByTagName(doc: Document, tagName: string): Element {
  const list = doc.getElementsByTagName(tagName)
  if (list.length === 0) {
    throw new Error(`Missing element: ${tagName}`)
  }
  return list.item(0)! as Element
}

function buildSignedFixture(options?: {
  includeExternalImage?: boolean
  checksum?: string
}): string {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  })
  const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey
  if (!jwk.n || !jwk.e) {
    throw new Error('RSA JWK is missing modulus/exponent')
  }

  const checksum = options?.checksum ?? 'sha256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='
  const imageNode = options?.includeExternalImage
    ? `<Image geometry="1:1:1" sampleFormat="UInt8" location="path(@header_dir/data.bin)" checksum="${checksum}" />`
    : ''

  const template = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata />
  <Property Id="payload" uid="payload" id="Meta:Name" type="String" value="ok" />
  ${imageNode}
  <Signature xmlns="${__signatureTesting.constants.DSIG_NS}">
    <SignedInfo>
      <CanonicalizationMethod Algorithm="${__signatureTesting.constants.C14N_10}" />
      <SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" />
      <Reference URI="#payload">
        <Transforms>
          <Transform Algorithm="${__signatureTesting.constants.C14N_10}" />
        </Transforms>
        <DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256" />
        <DigestValue></DigestValue>
      </Reference>
    </SignedInfo>
    <SignatureValue></SignatureValue>
    <KeyInfo>
      <KeyValue>
        <RSAKeyValue>
          <Modulus>${base64UrlToBase64(jwk.n)}</Modulus>
          <Exponent>${base64UrlToBase64(jwk.e)}</Exponent>
        </RSAKeyValue>
      </KeyValue>
    </KeyInfo>
  </Signature>
</xisf>`

  const doc = new DOMParser().parseFromString(template, 'application/xml')
  const payloadElement = firstByTagName(doc, 'Property')
  const canonicalPayload = __signatureTesting.canonicalize(
    payloadElement,
    __signatureTesting.constants.C14N_10,
  )
  const digest = createHash('sha256').update(canonicalPayload).digest('base64')
  firstByTagName(doc, 'DigestValue').textContent = digest

  const signedInfo = firstByTagName(doc, 'SignedInfo')
  const canonicalSignedInfo = __signatureTesting.canonicalize(
    signedInfo,
    __signatureTesting.constants.C14N_10,
  )
  const signer = createSign('RSA-SHA256')
  signer.update(canonicalSignedInfo)
  signer.end()
  const signatureValue = signer.sign(privateKey).toString('base64')
  firstByTagName(doc, 'SignatureValue').textContent = signatureValue

  return new XMLSerializer().serializeToString(doc)
}

describe('XISF', () => {
  it('writes and reads monolithic XISF with strict checksum validation', async () => {
    const data = Uint8Array.from([1, 2, 3, 4])
    const unit = makeSimpleUnit(data)

    const serialized = await XISFWriter.toMonolithic(unit)
    const parsed = await XISF.fromArrayBuffer(serialized)
    const image = parsed.unit.images[0]!

    expect(image.sampleFormat).toBe('UInt8')
    expect(image.geometry).toEqual([2, 2])
    expect(Array.from(image.data!)).toEqual([1, 2, 3, 4])
  })

  it('throws in strict mode when checksum validation fails', async () => {
    const data = Uint8Array.from([10, 11, 12, 13, 14, 15, 16, 17])
    const unit = makeSimpleUnit(data)
    const serialized = await XISFWriter.toMonolithic(unit, { compression: 'zlib' })

    const damaged = new Uint8Array(serialized.slice(0))
    damaged[damaged.length - 1] ^= 0xff

    await expect(XISF.fromArrayBuffer(toArrayBuffer(damaged))).rejects.toBeInstanceOf(
      XISFChecksumError,
    )
  })

  it('writes and reads distributed XISF with XISB index-id blocks', async () => {
    const longText = 'distributed-property-'.repeat(300)
    const unit: XISFUnit = {
      ...makeSimpleUnit(Uint8Array.from([9, 8, 7, 6])),
      metadata: [{ id: 'Observation:Description', type: 'String', value: longText }],
      standaloneProperties: [{ id: 'Processing:Description', type: 'String', value: longText }],
    }

    const distributed = await XISFWriter.toDistributed(unit, { maxInlineBlockSize: 32 })
    const parsed = await XISF.fromArrayBuffer(toArrayBuffer(distributed.header), {
      headerDir: '/tmp/xisf',
      resourceResolver: {
        resolveURL: async () => {
          throw new Error('not expected')
        },
        resolvePath: async (path) => {
          if (!path.endsWith('/blocks.xisb')) {
            throw new Error(`unexpected path: ${path}`)
          }
          return distributed.blocks['blocks.xisb']!
        },
      },
    })

    expect(Array.from(parsed.unit.images[0]!.data!)).toEqual([9, 8, 7, 6])
    expect(parsed.unit.metadata[0]!.value).toBe(longText)
    expect(parsed.unit.standaloneProperties[0]!.value).toBe(longText)
  })

  it('parses location syntax and resolves @header_dir correctly', () => {
    const byUrl = parseXISFLocation('url(ftp://ftp.example.com/public/example(2016).dat):0x10')
    expect(byUrl.type).toBe('url')
    if (byUrl.type === 'url') {
      expect(byUrl.url).toBe('ftp://ftp.example.com/public/example(2016).dat')
      expect(byUrl.indexId).toBe(BigInt(16))
    }

    const byPath = parseXISFLocation('path(@header_dir/sample-screenshots.xisb):42')
    expect(byPath.type).toBe('path')
    if (byPath.type === 'path') {
      expect(byPath.path).toBe('@header_dir/sample-screenshots.xisb')
      expect(byPath.indexId).toBe(BigInt(42))
    }

    const resolved = resolveHeaderRelativePath(
      '@header_dir/blocks.xisb',
      'https://example.com/data',
    )
    expect(resolved).toBe('https://example.com/data/blocks.xisb')
  })

  it('builds and parses XISB index structures', () => {
    const a = Uint8Array.from([1, 2, 3])
    const b = Uint8Array.from([4, 5, 6, 7])
    const { bytes, ids } = buildXISBFile([a, b])
    const index = parseXISBIndex(toArrayBuffer(bytes))

    const first = index.byId.get(ids[0]!)
    const second = index.byId.get(ids[1]!)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(Array.from(sliceXISBBlock(toArrayBuffer(bytes), first!))).toEqual([1, 2, 3])
    expect(Array.from(sliceXISBBlock(toArrayBuffer(bytes), second!))).toEqual([4, 5, 6, 7])
  })

  it('fails strict signature verification and allows relaxed fallback', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata />
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <SignedInfo>
      <SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" />
    </SignedInfo>
    <SignatureValue>ZmFrZQ==</SignatureValue>
  </Signature>
</xisf>`
    const bytes = new TextEncoder().encode(xml)

    await expect(XISF.fromArrayBuffer(toArrayBuffer(bytes))).rejects.toBeInstanceOf(
      XISFSignatureError,
    )

    const parsed = await XISF.fromArrayBuffer(toArrayBuffer(bytes), {
      strictValidation: false,
      signaturePolicy: 'warn',
    })
    expect(parsed.unit.signature.present).toBe(true)
    expect(parsed.unit.signature.verified).toBe(false)
  })

  it('verifies valid detached signatures in require mode', async () => {
    const xml = buildSignedFixture()
    const parsed = await XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(xml)))
    expect(parsed.unit.signature.present).toBe(true)
    expect(parsed.unit.signature.verified).toBe(true)
    expect(parsed.unit.signature.algorithm).toBe(
      'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    )
  })

  it('rejects signed XML when SignedInfo digest is tampered', async () => {
    const xml = buildSignedFixture()
    const tampered = xml.replace('value="ok"', 'value="altered"')
    await expect(
      XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(tampered))),
    ).rejects.toBeInstanceOf(XISFSignatureError)
  })

  it('rejects signed XML when SignatureValue is tampered', async () => {
    const xml = buildSignedFixture()
    const tampered = xml.replace(
      /<SignatureValue>([^<]+)<\/SignatureValue>/u,
      (_all, value: string) => {
        const mutated = value.length > 0 ? `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}` : 'A'
        return `<SignatureValue>${mutated}</SignatureValue>`
      },
    )
    await expect(
      XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(tampered))),
    ).rejects.toBeInstanceOf(XISFSignatureError)
  })

  it('forces checksum verification for signed external blocks', async () => {
    const xml = buildSignedFixture({
      includeExternalImage: true,
      checksum: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    })
    await expect(
      XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(xml)), {
        verifyChecksums: false,
        headerDir: '/tmp/xisf',
        resourceResolver: {
          resolveURL: async () => {
            throw new Error('not expected')
          },
          resolvePath: async () => Uint8Array.from([9]),
        },
      }),
    ).rejects.toBeInstanceOf(XISFChecksumError)
  })

  it('decodes big-endian vector properties correctly', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata>
    <Property id="P:UI16" type="UI16Vector" length="2" byteOrder="big" location="inline:base64">AAEBAA==</Property>
  </Metadata>
</xisf>`
    const parsed = await XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(xml)))
    const value = parsed.unit.metadata[0]!.value as ArrayLike<number>
    expect(Array.from(value)).toEqual([1, 256])
  })

  it('round-trips typed metadata vectors with explicit big-endian byteOrder', async () => {
    const unit: XISFUnit = {
      ...makeSimpleUnit(Uint8Array.from([1, 2, 3, 4])),
      metadata: [
        {
          id: 'Meta:UI16',
          type: 'UI16Vector',
          value: [1, 256],
          dataBlock: {
            location: { type: 'attachment', position: 0, size: 0 },
            byteOrder: 'big',
          },
        },
      ],
    }
    const serialized = await XISFWriter.toMonolithic(unit, { maxInlineBlockSize: 1 })
    const parsed = await XISF.fromArrayBuffer(serialized)
    const value = parsed.unit.metadata[0]!.value as ArrayLike<number>
    expect(Array.from(value)).toEqual([1, 256])
    expect(parsed.unit.metadata[0]!.dataBlock?.byteOrder).toBe('big')
  })

  it('parses table cells using Structure field types', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata />
  <Structure uid="S1">
    <Field id="A" type="UInt32" />
  </Structure>
  <Table id="T1" rows="1" columns="1">
    <Reference ref="S1" />
    <Row>
      <Cell value="42" />
    </Row>
  </Table>
</xisf>`
    const parsed = await XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(xml)))
    expect(parsed.unit.standaloneTables).toHaveLength(1)
    expect(parsed.unit.standaloneTables[0]!.dataRows[0]!.cells[0]!.type).toBe('UInt32')
    expect(parsed.unit.standaloneTables[0]!.dataRows[0]!.cells[0]!.value).toBe(42)
  })

  it('rejects Float32 images without bounds in strict mode', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata />
  <Image geometry="1:1:1" sampleFormat="Float32" location="embedded">
    <Data encoding="base64">AAAAAA==</Data>
  </Image>
</xisf>`
    await expect(
      XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(xml))),
    ).rejects.toBeInstanceOf(XISFValidationError)
    const relaxed = await XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(xml)), {
      strictValidation: false,
    })
    expect(relaxed.unit.images).toHaveLength(1)
  })

  it('rejects ICCProfile byteOrder in strict mode', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata />
  <Image geometry="1:1:1" sampleFormat="UInt8" location="embedded">
    <Data encoding="base64">AQ==</Data>
    <ICCProfile byteOrder="little" location="inline:base64">AQIDBA==</ICCProfile>
  </Image>
</xisf>`
    await expect(
      XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(xml))),
    ).rejects.toBeInstanceOf(XISFValidationError)
    const relaxed = await XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(xml)), {
      strictValidation: false,
    })
    expect(relaxed.unit.images[0]!.iccProfile?.byteLength).toBe(4)
  })

  it('rejects chained references', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">
  <Metadata />
  <Property uid="P0" id="Meta:Name" type="String" value="ok" />
  <Reference uid="R0" ref="P0" />
  <Image geometry="1:1:1" sampleFormat="UInt8" location="embedded">
    <Data encoding="base64">AQ==</Data>
    <Reference ref="R0" />
  </Image>
</xisf>`
    await expect(
      XISF.fromArrayBuffer(toArrayBuffer(new TextEncoder().encode(xml))),
    ).rejects.toBeInstanceOf(XISFValidationError)
  })
})
