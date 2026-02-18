import { describe, expect, it } from 'vitest'
import { buildXISBFile, parseXISBIndex, sliceXISBBlock } from '../src/xisb-index'
import { XISFParseError, XISFValidationError } from '../src/xisf-errors'

function signatureBytes(): Uint8Array {
  return new TextEncoder().encode('XISB0100')
}

describe('xisb-index', () => {
  it('builds, parses and slices blocks', () => {
    const a = Uint8Array.from([1, 2, 3, 4])
    const b = Uint8Array.from([5, 6])
    const { bytes, ids } = buildXISBFile([a, b])
    const index = parseXISBIndex(bytes.buffer.slice(0))

    expect(index.elements).toHaveLength(2)
    expect(index.byId.get(ids[0]!)?.blockLength).toBe(BigInt(4))
    expect(index.byId.get(ids[1]!)?.blockLength).toBe(BigInt(2))
    expect(Array.from(sliceXISBBlock(bytes.buffer.slice(0), index.byId.get(ids[0]!)!))).toEqual([
      1, 2, 3, 4,
    ])
    expect(Array.from(sliceXISBBlock(bytes.buffer.slice(0), index.byId.get(ids[1]!)!))).toEqual([
      5, 6,
    ])
  })

  it('rejects short and invalid signatures', () => {
    expect(() => parseXISBIndex(new ArrayBuffer(8))).toThrow(XISFParseError)

    const bad = new Uint8Array(32)
    bad.set(new TextEncoder().encode('NOTXISB!'), 0)
    expect(() => parseXISBIndex(bad.buffer)).toThrow(XISFParseError)
  })

  it('rejects malformed node and element pointers', () => {
    const bytes = new Uint8Array(40)
    bytes.set(signatureBytes(), 0)
    const view = new DataView(bytes.buffer)

    // node @16 => length=1 but buffer cannot hold one full element (40 bytes)
    view.setUint32(16, 1, true)
    view.setBigUint64(24, BigInt(0), true)
    expect(() => parseXISBIndex(bytes.buffer)).toThrow('Invalid XISB index element offset')

    // node points out of bounds
    const outOfBoundsNode = new Uint8Array(32)
    outOfBoundsNode.set(signatureBytes(), 0)
    const v2 = new DataView(outOfBoundsNode.buffer)
    v2.setUint32(16, 0, true)
    v2.setBigUint64(24, BigInt(999), true)
    expect(() => parseXISBIndex(outOfBoundsNode.buffer)).toThrow('Invalid XISB index node offset')
  })

  it('rejects cyclic node lists and oversized bigint node pointer conversion', () => {
    const cyclic = new Uint8Array(32)
    cyclic.set(signatureBytes(), 0)
    const view = new DataView(cyclic.buffer)
    view.setUint32(16, 0, true)
    view.setBigUint64(24, BigInt(16), true)
    expect(() => parseXISBIndex(cyclic.buffer)).toThrow('cyclic block index list')

    const huge = new Uint8Array(32)
    huge.set(signatureBytes(), 0)
    const viewHuge = new DataView(huge.buffer)
    viewHuge.setUint32(16, 0, true)
    viewHuge.setBigUint64(24, BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), true)
    expect(() => parseXISBIndex(huge.buffer)).toThrow(XISFValidationError)
  })

  it('rejects invalid/free block slices', () => {
    const payload = new Uint8Array(16)
    expect(() =>
      sliceXISBBlock(payload.buffer, {
        uniqueId: BigInt(1),
        blockPosition: BigInt(0),
        blockLength: BigInt(10),
        uncompressedBlockLength: BigInt(0),
      }),
    ).toThrow(XISFValidationError)

    expect(() =>
      sliceXISBBlock(payload.buffer, {
        uniqueId: BigInt(2),
        blockPosition: BigInt(12),
        blockLength: BigInt(8),
        uncompressedBlockLength: BigInt(0),
      }),
    ).toThrow(XISFParseError)
  })
})
