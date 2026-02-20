import { describe, expect, it } from 'vitest'
import { FITS } from '../src/fits'
import { Image } from '../src/image'
import { XISF } from '../src/xisf'
import { XISFWriter } from '../src/xisf-writer'
import {
  convertFitsToSer,
  convertSerToFits,
  convertSerToXisf,
  convertXisfToSer,
} from '../src/ser-convert'
import { createImageBytesFromArray, createImageHDU, writeFITS } from '../src/fits-writer'
import { parseSERBuffer } from '../src/ser-parser'
import { buildSerSequence } from './ser-helpers'
import { makeSimpleImage } from './helpers'
import type { XISFUnit } from '../src/xisf-types'

function getFrameRawBytes(buffer: ArrayBuffer, offset: number, byteLength: number): Uint8Array {
  return new Uint8Array(buffer.slice(offset, offset + byteLength))
}

describe('SER conversions', () => {
  it('round-trips SER -> FITS -> SER with timestamps', async () => {
    const source = buildSerSequence({
      colorId: 0,
      width: 4,
      height: 3,
      pixelDepth: 16,
      frameCount: 3,
      withTimestamps: true,
    })

    const fits = await convertSerToFits(source.buffer)
    const back = await convertFitsToSer(fits)

    const a = parseSERBuffer(source.buffer)
    const b = parseSERBuffer(back)

    expect(b.header.width).toBe(a.header.width)
    expect(b.header.height).toBe(a.header.height)
    expect(b.header.colorId).toBe(a.header.colorId)
    expect(b.header.frameCount).toBe(a.header.frameCount)
    expect(b.timestamps).toEqual(a.timestamps)

    for (let i = 0; i < a.frameInfos.length; i++) {
      const aa = getFrameRawBytes(
        source.buffer,
        a.frameInfos[i]!.offset,
        a.frameInfos[i]!.byteLength,
      )
      const bb = getFrameRawBytes(back, b.frameInfos[i]!.offset, b.frameInfos[i]!.byteLength)
      expect(Array.from(bb)).toEqual(Array.from(aa))
    }
  })

  it('supports SER -> FITS (multi-hdu) -> SER with auto source detection', async () => {
    const source = buildSerSequence({
      colorId: 0,
      width: 3,
      height: 2,
      pixelDepth: 16,
      frameCount: 3,
      withTimestamps: true,
    })

    const fitsMulti = await convertSerToFits(source.buffer, { layout: 'multi-hdu' })
    const parsedFits = FITS.fromArrayBuffer(fitsMulti)
    const imageHDUs = parsedFits.hdus.filter((hdu) => hdu.data instanceof Image)
    expect(imageHDUs).toHaveLength(3)
    expect(imageHDUs[1]?.header.getNumber('SERFRAME')).toBe(1)

    const back = await convertFitsToSer(fitsMulti, { sourceLayout: 'auto' })
    const sourceParsed = parseSERBuffer(source.buffer)
    const backParsed = parseSERBuffer(back)
    expect(backParsed.header.frameCount).toBe(sourceParsed.header.frameCount)
    expect(backParsed.timestamps).toEqual(sourceParsed.timestamps)

    for (let i = 0; i < sourceParsed.frameInfos.length; i++) {
      const expected = getFrameRawBytes(
        source.buffer,
        sourceParsed.frameInfos[i]!.offset,
        sourceParsed.frameInfos[i]!.byteLength,
      )
      const actual = getFrameRawBytes(
        back,
        backParsed.frameInfos[i]!.offset,
        backParsed.frameInfos[i]!.byteLength,
      )
      expect(Array.from(actual)).toEqual(Array.from(expected))
    }
  })

  it('supports explicit multi-hdu source layout for RGB sequences', async () => {
    const source = buildSerSequence({
      colorId: 100,
      width: 2,
      height: 2,
      pixelDepth: 8,
      frameCount: 2,
      withTimestamps: true,
    })

    const fitsMulti = await convertSerToFits(source.buffer, { layout: 'multi-hdu' })
    const back = await convertFitsToSer(fitsMulti, { sourceLayout: 'multi-hdu' })
    const sourceParsed = parseSERBuffer(source.buffer)
    const backParsed = parseSERBuffer(back)
    expect(backParsed.header.colorId).toBe(100)
    expect(backParsed.header.frameCount).toBe(2)
    expect(backParsed.timestamps).toEqual(sourceParsed.timestamps)

    for (let i = 0; i < sourceParsed.frameInfos.length; i++) {
      const expected = getFrameRawBytes(
        source.buffer,
        sourceParsed.frameInfos[i]!.offset,
        sourceParsed.frameInfos[i]!.byteLength,
      )
      const actual = getFrameRawBytes(
        back,
        backParsed.frameInfos[i]!.offset,
        backParsed.frameInfos[i]!.byteLength,
      )
      expect(Array.from(actual)).toEqual(Array.from(expected))
    }
  })

  it('round-trips SER -> XISF -> SER for BGR data', async () => {
    const source = buildSerSequence({
      colorId: 101,
      width: 3,
      height: 2,
      pixelDepth: 8,
      frameCount: 2,
      withTimestamps: true,
    })

    const xisf = await convertSerToXisf(source.buffer)
    const back = await convertXisfToSer(xisf as ArrayBuffer)

    const a = parseSERBuffer(source.buffer)
    const b = parseSERBuffer(back)
    expect(b.header.colorId).toBe(101)
    expect(b.header.frameCount).toBe(2)
    expect(b.timestamps).toEqual(a.timestamps)
  })

  it('supports FITS -> SER -> FITS without SER metadata by inferring mono layout', async () => {
    const fitsSrc = makeSimpleImage(2, 2, 16, [10, 20, 30, 40])
    const serBuffer = await convertFitsToSer(fitsSrc)
    const fitsBack = await convertSerToFits(serBuffer)

    const parsed = FITS.fromArrayBuffer(fitsBack)
    expect(parsed.getHeader()!.getNumber('NAXIS1')).toBe(2)
    expect(parsed.getHeader()!.getNumber('NAXIS2')).toBe(2)
    expect(parsed.getHeader()!.getNumber('NAXIS')).toBe(2)
    expect(parsed.getHeader()!.getNumber('SERCOLOR')).toBe(0)
  })

  it('auto-detects generic multi-hdu FITS sequences without SER metadata', async () => {
    const frame0 = [1, 2, 3, 4]
    const frame1 = [11, 12, 13, 14]
    const fits = writeFITS([
      createImageHDU({
        width: 2,
        height: 2,
        bitpix: 8,
        data: createImageBytesFromArray(frame0, 8),
      }),
      createImageHDU({
        primary: false,
        extensionType: 'IMAGE',
        width: 2,
        height: 2,
        bitpix: 8,
        data: createImageBytesFromArray(frame1, 8),
        extname: 'FRAME_1',
      }),
    ])

    const serBytes = await convertFitsToSer(fits, { sourceLayout: 'auto' })
    const serParsed = parseSERBuffer(serBytes)
    expect(serParsed.header.colorId).toBe(0)
    expect(serParsed.header.frameCount).toBe(2)

    const backFrame0 = getFrameRawBytes(
      serBytes,
      serParsed.frameInfos[0]!.offset,
      serParsed.frameInfos[0]!.byteLength,
    )
    const backFrame1 = getFrameRawBytes(
      serBytes,
      serParsed.frameInfos[1]!.offset,
      serParsed.frameInfos[1]!.byteLength,
    )
    expect(Array.from(backFrame0)).toEqual(frame0)
    expect(Array.from(backFrame1)).toEqual(frame1)
  })

  it('supports XISF -> SER -> XISF with SER metadata restoration', async () => {
    const frameTs = new BigUint64Array([638000000000000000n, 638000000000100000n])
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const unit: XISFUnit = {
      metadata: [
        { id: 'SER:ColorID', type: 'Int32', value: 8 },
        { id: 'SER:PixelDepth', type: 'Int32', value: 8 },
        { id: 'SER:LittleEndian', type: 'Boolean', value: true },
        { id: 'SER:FrameTimestamps', type: 'UI64Vector', value: frameTs },
      ],
      images: [
        {
          id: 'SERSEQ',
          geometry: [2, 2, 2],
          channelCount: 1,
          sampleFormat: 'UInt8',
          pixelStorage: 'Planar',
          colorSpace: 'Gray',
          colorFilterArray: { pattern: 'RGGB', width: 2, height: 2 },
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
    const xisfBytes = await XISFWriter.toMonolithic(unit)
    const serBytes = await convertXisfToSer(xisfBytes)
    const xisfBack = await convertSerToXisf(serBytes)
    const parsed = await XISF.fromArrayBuffer(xisfBack as ArrayBuffer)

    const colorId = parsed.unit.metadata.find((m) => m.id === 'SER:ColorID')?.value
    const timestamps = parsed.unit.metadata.find((m) => m.id === 'SER:FrameTimestamps')?.value
    expect(colorId).toBe(8)
    expect(ArrayBuffer.isView(timestamps)).toBe(true)
  })

  it('selects image by imageIndex when converting XISF -> SER', async () => {
    const imageA = new Uint8Array([1, 2, 3, 4])
    const imageB = new Uint8Array([21, 22, 23, 24])
    const unit: XISFUnit = {
      metadata: [],
      images: [
        {
          id: 'A',
          geometry: [2, 2, 1],
          channelCount: 1,
          sampleFormat: 'UInt8',
          pixelStorage: 'Planar',
          colorSpace: 'Gray',
          dataBlock: {
            location: { type: 'attachment', position: 0, size: imageA.byteLength },
            byteOrder: 'little',
          },
          data: imageA,
          properties: [],
          tables: [],
          fitsKeywords: [],
        },
        {
          id: 'B',
          geometry: [2, 2, 1],
          channelCount: 1,
          sampleFormat: 'UInt8',
          pixelStorage: 'Planar',
          colorSpace: 'Gray',
          dataBlock: {
            location: { type: 'attachment', position: 0, size: imageB.byteLength },
            byteOrder: 'little',
          },
          data: imageB,
          properties: [{ id: 'SER:Observer', type: 'String', value: 'second-image' }],
          tables: [],
          fitsKeywords: [],
        },
      ],
      standaloneProperties: [],
      standaloneTables: [],
      version: '1.0',
      signature: { present: false, verified: true },
    }

    const xisfBytes = await XISFWriter.toMonolithic(unit)
    const serBytes = await convertXisfToSer(xisfBytes, { imageIndex: 1 })
    const parsed = parseSERBuffer(serBytes)
    expect(parsed.header.frameCount).toBe(1)
    expect(parsed.header.observer).toBe('second-image')

    const frame = getFrameRawBytes(
      serBytes,
      parsed.frameInfos[0]!.offset,
      parsed.frameInfos[0]!.byteLength,
    )
    expect(Array.from(frame)).toEqual(Array.from(imageB))
  })

  it('throws on invalid XISF imageIndex for SER conversion', async () => {
    const unit: XISFUnit = {
      metadata: [],
      images: [
        {
          id: 'A',
          geometry: [1, 1, 1],
          channelCount: 1,
          sampleFormat: 'UInt8',
          pixelStorage: 'Planar',
          colorSpace: 'Gray',
          dataBlock: {
            location: { type: 'attachment', position: 0, size: 1 },
            byteOrder: 'little',
          },
          data: new Uint8Array([7]),
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
    const xisfBytes = await XISFWriter.toMonolithic(unit)
    await expect(convertXisfToSer(xisfBytes, { imageIndex: 2 })).rejects.toThrow(/index 2/i)
  })
})
