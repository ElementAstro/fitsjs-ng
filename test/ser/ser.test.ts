import { describe, expect, it, vi } from 'vitest'
import { SER } from '../../src/ser'
import { parseSERBuffer } from '../../src/ser/ser-parser'
import { writeSER } from '../../src/ser/ser-writer'
import { SERParseError, SERValidationError } from '../../src/ser/ser-errors'
import { buildSerSequence, makeFrameU16LE } from './ser-helpers'
import type { SERColorId, SERWarning } from '../../src/ser/ser-types'

describe('SER parser and class', () => {
  it('parses SER header and frames', () => {
    const { buffer, frames, timestamps } = buildSerSequence({
      colorId: 0,
      width: 4,
      height: 3,
      pixelDepth: 8,
      frameCount: 2,
      withTimestamps: true,
    })

    const parsed = parseSERBuffer(buffer)
    expect(parsed.header.fileId).toBe('LUCAM-RECORDER')
    expect(parsed.header.width).toBe(4)
    expect(parsed.header.height).toBe(3)
    expect(parsed.header.pixelDepth).toBe(8)
    expect(parsed.header.frameCount).toBe(2)
    expect(parsed.timestampsPresent).toBe(true)
    expect(parsed.timestamps).toEqual(timestamps)

    const ser = SER.fromArrayBuffer(buffer)
    const frame0 = ser.getFrame(0)
    expect(Array.from(frame0.raw)).toEqual(Array.from(frames[0]!))
    expect(frame0.channelCount).toBe(1)
    expect(frame0.samples).toBeInstanceOf(Uint8Array)
    expect(ser.getTimestamp(1)).toBe(timestamps![1])
  })

  it('supports all SER color IDs', () => {
    const colorIds: SERColorId[] = [0, 8, 9, 10, 11, 16, 17, 18, 19, 100, 101]
    for (const colorId of colorIds) {
      const { buffer } = buildSerSequence({
        colorId,
        width: 2,
        height: 2,
        pixelDepth: 8,
        frameCount: 1,
      })
      const parsed = parseSERBuffer(buffer)
      expect(parsed.header.colorId).toBe(colorId)
      expect(parsed.header.channelCount).toBe(colorId >= 100 ? 3 : 1)
    }
  })

  it('applies compat/spec/auto endianness policies', () => {
    const frame = makeFrameU16LE(2, 1, 1, 1234)
    const buffer = writeSER({
      header: {
        colorId: 0,
        width: 2,
        height: 1,
        pixelDepth: 16,
        littleEndian: true,
      },
      frames: [frame],
    })

    const compat = parseSERBuffer(buffer, { endiannessPolicy: 'compat' })
    const spec = parseSERBuffer(buffer, { endiannessPolicy: 'spec' })
    const auto = parseSERBuffer(buffer, { endiannessPolicy: 'auto' })

    expect(compat.header.byteOrder).toBe('little')
    expect(spec.header.byteOrder).toBe('big')
    expect(auto.header.byteOrder).toMatch(/little|big/)
  })

  it('warns in relaxed mode for truncated timestamp trailer', () => {
    const warnings: SERWarning[] = []
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 2,
      withTimestamps: true,
    })
    const truncated = buffer.slice(0, buffer.byteLength - 7)

    const parsed = parseSERBuffer(truncated, {
      strictValidation: false,
      onWarning: (warning) => warnings.push(warning),
    })
    expect(parsed.timestampsPresent).toBe(false)
    expect(warnings.some((w) => w.code === 'truncated_timestamps')).toBe(true)
  })

  it('keeps out-of-order timestamps and emits warning', () => {
    const warnings: SERWarning[] = []
    const { buffer, timestamps } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 3,
      withTimestamps: true,
    })
    const bytes = new Uint8Array(buffer)
    const view = new DataView(bytes.buffer)
    const trailerOffset = 178 + 2 * 2 * 3
    view.setBigUint64(trailerOffset + 8, timestamps![2]!, true)
    view.setBigUint64(trailerOffset + 16, timestamps![1]!, true)

    const parsed = parseSERBuffer(bytes.buffer, {
      strictValidation: false,
      onWarning: (warning) => warnings.push(warning),
    })
    expect(parsed.timestamps).toHaveLength(3)
    expect(warnings.some((w) => w.code === 'timestamps_not_ordered')).toBe(true)
  })

  it('throws in strict mode for truncated timestamp trailer', () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 2,
      withTimestamps: true,
    })
    const truncated = buffer.slice(0, buffer.byteLength - 3)
    expect(() => parseSERBuffer(truncated, { strictValidation: true })).toThrow(SERValidationError)
  })

  it('throws on invalid magic', () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 1,
    })
    const bytes = new Uint8Array(buffer)
    bytes[0] = 88
    expect(() => parseSERBuffer(bytes.buffer)).toThrow(SERParseError)
  })

  it('returns RGB helper output from Bayer and BGR frames', () => {
    const bayer = buildSerSequence({
      colorId: 8,
      width: 4,
      height: 4,
      pixelDepth: 8,
      frameCount: 1,
    })
    const serBayer = SER.fromArrayBuffer(bayer.buffer)
    const rgbBayer = serBayer.getFrameRGB(0)
    expect(rgbBayer.length).toBe(4 * 4 * 3)

    const bgr = buildSerSequence({
      colorId: 101,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 1,
    })
    const serBgr = SER.fromArrayBuffer(bgr.buffer)
    const rgb = serBgr.getFrameRGB(0)
    expect(rgb.length).toBe(2 * 2 * 3)
  })

  it('iterates frames with async iterator', async () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 3,
    })
    const ser = SER.fromArrayBuffer(buffer)

    let count = 0
    for await (const frame of ser) {
      expect(frame.width).toBe(2)
      count++
    }
    expect(count).toBe(3)
  })

  it('exposes timing and fps convenience metrics', () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 3,
      withTimestamps: true,
    })
    const ser = SER.fromArrayBuffer(buffer)

    expect(ser.getFrameCount()).toBe(3)
    expect(ser.getDurationTicks()).toBe(200000n)
    expect(ser.getDurationSeconds()).toBeCloseTo(0.02, 8)
    expect(ser.getEstimatedFPS()).toBeCloseTo(100, 8)
  })

  it('returns undefined metrics when timestamps are unavailable', () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 2,
      withTimestamps: false,
    })
    const ser = SER.fromArrayBuffer(buffer)
    expect(ser.getDurationTicks()).toBeUndefined()
    expect(ser.getDurationSeconds()).toBeUndefined()
    expect(ser.getEstimatedFPS()).toBeUndefined()
  })

  it('keeps previously-read frames stable in copy mode', () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 1,
    })

    const ser = SER.fromArrayBuffer(buffer)
    const frame = ser.getFrame(0)
    const before = frame.raw[0]
    const source = new Uint8Array(buffer)
    source[frame.info.offset] = (before + 9) & 0xff

    expect(frame.raw[0]).toBe(before)
  })

  it('exposes view semantics from fromBytes by default', () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 1,
    })
    const source = new Uint8Array(buffer)
    const ser = SER.fromBytes(source)
    const frame = ser.getFrame(0)
    const nextValue = (frame.raw[0]! + 7) & 0xff

    source[frame.info.offset] = nextValue
    expect(frame.raw[0]).toBe(nextValue)
    expect((frame.samples as Uint8Array)[0]).toBe(nextValue)
  })

  it('uses zero-copy fromNodeBuffer when frameStorage=view', () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 1,
    })
    const source = new Uint8Array(buffer)
    const ser = SER.fromNodeBuffer(
      {
        buffer: source.buffer,
        byteOffset: source.byteOffset,
        byteLength: source.byteLength,
      },
      { frameStorage: 'view' },
    )
    const frame = ser.getFrame(0)
    const changed = (frame.raw[0]! + 3) & 0xff

    source[frame.info.offset] = changed
    expect(frame.raw[0]).toBe(changed)
  })

  it('allows per-call frameStorage override', () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 1,
    })
    const source = new Uint8Array(buffer)
    const ser = SER.fromBytes(source)
    const frameCopy = ser.getFrame(0, { frameStorage: 'copy' })
    const frameView = ser.getFrame(0, { frameStorage: 'view' })
    const mutated = (frameCopy.raw[0]! + 11) & 0xff

    source[frameCopy.info.offset] = mutated
    expect(frameCopy.raw[0]).not.toBe(mutated)
    expect(frameView.raw[0]).toBe(mutated)
  })

  it('uses fast-path decoding for aligned little-endian 16-bit frames', () => {
    const frame = makeFrameU16LE(3, 2, 1, 1200)
    const buffer = writeSER({
      header: {
        colorId: 0,
        width: 3,
        height: 2,
        pixelDepth: 16,
        littleEndian: true,
      },
      frames: [frame],
    })
    const ser = SER.fromBytes(new Uint8Array(buffer), { frameStorage: 'view' })
    const decoded = ser.getFrame(0)

    expect(decoded.samples).toBeInstanceOf(Uint16Array)
    expect((decoded.samples as Uint16Array).buffer).toBe(decoded.raw.buffer)
    expect((decoded.samples as Uint16Array)[0]).toBe(1200)
    expect((decoded.samples as Uint16Array)[1]).toBe(1297)
  })

  it('falls back to DataView decode for big-endian 16-bit frames', () => {
    const width = 2
    const height = 2
    const pixels = width * height
    const frame = new Uint8Array(pixels * 2)
    const view = new DataView(frame.buffer)
    const values = [1000, 2000, 3000, 4000]
    for (let i = 0; i < values.length; i++) {
      view.setUint16(i * 2, values[i]!, false)
    }

    const buffer = writeSER(
      {
        header: {
          colorId: 0,
          width,
          height,
          pixelDepth: 16,
          littleEndian: false,
        },
        frames: [frame],
      },
      { endiannessPolicy: 'spec' },
    )

    const ser = SER.fromBytes(new Uint8Array(buffer), {
      frameStorage: 'view',
      endiannessPolicy: 'spec',
    })
    const decoded = ser.getFrame(0)

    expect(decoded.samples).toBeInstanceOf(Uint16Array)
    expect(Array.from(decoded.samples as Uint16Array)).toEqual(values)
    expect((decoded.samples as Uint16Array).buffer).not.toBe(decoded.raw.buffer)
  })

  it('applies requestInit and retry options in SER.fromURL', async () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 1,
    })
    const bytes = new Uint8Array(buffer)
    let attempts = 0

    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      attempts++
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer ser-token')
      expect(init?.credentials).toBe('include')
      if (attempts === 1) {
        return new Response('temporary failure', { status: 503, statusText: 'Service Unavailable' })
      }
      return new Response(bytes, { status: 200 })
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      const ser = await SER.fromURL('https://example.test/capture.ser', {
        requestInit: {
          credentials: 'include',
          headers: {
            Authorization: 'Bearer ser-token',
          },
        },
        retryCount: 1,
        retryDelayMs: 0,
      })
      expect(ser.getFrameCount()).toBe(1)
      expect(attempts).toBe(2)
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('supports timeout control in SER.fromURL', async () => {
    const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        if (signal.aborted) {
          reject(new Error('aborted'))
          return
        }
        signal.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'))
          },
          { once: true },
        )
      })
    })

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        SER.fromURL('https://example.test/timeout.ser', {
          timeoutMs: 15,
        }),
      ).rejects.toThrow('timed out')
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })
})
