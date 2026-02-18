import { describe, expect, it } from 'vitest'
import * as api from '../src/index'

describe('index exports', () => {
  it('exposes key runtime symbols', () => {
    expect(api.FITS).toBeTypeOf('function')
    expect(api.XISF).toBeTypeOf('function')
    expect(api.XISFWriter).toBeTypeOf('function')
    expect(api.HiPS).toBeTypeOf('function')
    expect(api.Header).toBeTypeOf('function')
    expect(api.Image).toBeTypeOf('function')
    expect(api.Table).toBeTypeOf('function')
    expect(api.BinaryTable).toBeTypeOf('function')
    expect(api.CompressedImage).toBeTypeOf('function')
    expect(api.NodeFSTarget).toBeTypeOf('function')
    expect(api.BrowserZipTarget).toBeTypeOf('function')
  })

  it('exposes constants and helpers', () => {
    expect(api.BLOCK_LENGTH).toBe(2880)
    expect(api.LINE_WIDTH).toBe(80)
    expect(api.getExtent).toBeTypeOf('function')
    expect(api.getPixel).toBeTypeOf('function')
    expect(api.writeFITS).toBeTypeOf('function')
    expect(api.convertFitsToXisf).toBeTypeOf('function')
    expect(api.convertXisfToFits).toBeTypeOf('function')
  })
})
