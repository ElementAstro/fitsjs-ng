import { describe, expect, it } from 'vitest'
import { parseSERBuffer } from '../src/ser-parser'
import { writeSER } from '../src/ser-writer'
import { SERValidationError } from '../src/ser-errors'
import { buildSerSequence, makeFrameU8 } from './ser-helpers'
import type { SERWarning } from '../src/ser-types'

describe('SER writer', () => {
  it('writes and parses little-endian 16-bit sequences', () => {
    const { buffer } = buildSerSequence({
      colorId: 0,
      width: 3,
      height: 2,
      pixelDepth: 16,
      frameCount: 2,
      littleEndian: true,
      withTimestamps: true,
    })
    const parsed = parseSERBuffer(buffer, { endiannessPolicy: 'compat' })
    expect(parsed.header.byteOrder).toBe('little')
    expect(parsed.header.frameCount).toBe(2)
    expect(parsed.timestamps).toHaveLength(2)
  })

  it('throws on frame length mismatch in strict mode', () => {
    const frame = makeFrameU8(2, 2, 1, 1)
    const short = frame.slice(0, frame.length - 1)
    expect(() =>
      writeSER({
        header: { colorId: 0, width: 2, height: 2, pixelDepth: 8 },
        frames: [short],
      }),
    ).toThrow(SERValidationError)
  })

  it('pads/truncates frame length in relaxed mode', () => {
    const warnings: SERWarning[] = []
    const frame = makeFrameU8(2, 2, 1, 1)
    const short = frame.slice(0, frame.length - 2)
    const buffer = writeSER(
      {
        header: { colorId: 0, width: 2, height: 2, pixelDepth: 8 },
        frames: [short],
      },
      { strictValidation: false, onWarning: (warning) => warnings.push(warning) },
    )

    const parsed = parseSERBuffer(buffer)
    expect(parsed.frameInfos[0]!.byteLength).toBe(4)
    expect(warnings.some((w) => w.code === 'frame_length_adjusted')).toBe(true)
  })

  it('throws on timestamp count mismatch in strict mode', () => {
    const frame = makeFrameU8(2, 2, 1, 1)
    expect(() =>
      writeSER({
        header: { colorId: 0, width: 2, height: 2, pixelDepth: 8 },
        frames: [frame],
        timestamps: [1n, 2n],
      }),
    ).toThrow(SERValidationError)
  })

  it('round-trips SER -> parse -> write equivalently', () => {
    const source = buildSerSequence({
      colorId: 100,
      width: 3,
      height: 2,
      pixelDepth: 8,
      frameCount: 2,
      withTimestamps: true,
    })
    const parsed = parseSERBuffer(source.buffer)
    const frames = parsed.frameInfos.map((info) => {
      return new Uint8Array(source.buffer.slice(info.offset, info.offset + info.byteLength))
    })

    const rebuilt = writeSER({
      header: {
        colorId: parsed.header.colorId,
        width: parsed.header.width,
        height: parsed.header.height,
        pixelDepth: parsed.header.pixelDepth,
        frameCount: parsed.header.frameCount,
        littleEndian: parsed.header.byteOrder === 'little',
        luId: parsed.header.luId,
        observer: parsed.header.observer,
        instrument: parsed.header.instrument,
        telescope: parsed.header.telescope,
        startTime: parsed.header.startTime,
        startTimeUtc: parsed.header.startTimeUtc,
      },
      frames,
      timestamps: parsed.timestamps,
    })

    expect(Array.from(new Uint8Array(rebuilt))).toEqual(Array.from(new Uint8Array(source.buffer)))
  })
})
