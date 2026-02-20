import { describe, it, expect } from 'vitest'
import { Header } from '../../src/fits/header'
import { card, makeHeaderBlock } from '../shared/helpers'

describe('Header', () => {
  it('should parse a simple primary header', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                   16 / Bits per pixel'),
      card('NAXIS   =                    2 / Number of axes'),
      card('NAXIS1  =                  100 / Width'),
      card('NAXIS2  =                  200 / Height'),
    ])

    const header = new Header(headerStr)

    expect(header.isPrimary()).toBe(true)
    expect(header.isExtension()).toBe(false)
    expect(header.get('SIMPLE')).toBe(true)
    expect(header.get('BITPIX')).toBe(16)
    expect(header.get('NAXIS')).toBe(2)
    expect(header.get('NAXIS1')).toBe(100)
    expect(header.get('NAXIS2')).toBe(200)
  })

  it('should parse string values', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    0 / No data'),
      card("ORIGIN  = 'STScI/MAST'         / Origin of data"),
      card("DATE    = '2024-01-15'         / Date of creation"),
    ])

    const header = new Header(headerStr)
    expect(header.get('ORIGIN')).toBe('STScI/MAST')
    expect(header.get('DATE')).toBe('2024-01-15')
  })

  it('should parse float values', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                  -32 / Bits per pixel'),
      card('NAXIS   =                    2 / Number of axes'),
      card('NAXIS1  =                  100 / Width'),
      card('NAXIS2  =                  100 / Height'),
      card('CRVAL1  =          210.801868 / RA'),
      card('CRVAL2  =           54.348171 / DEC'),
      card('CD1_1   =       -0.0002798094 / CD matrix'),
      card('BSCALE  =                  1.0 / Scale'),
      card('BZERO   =              32768.0 / Zero point'),
    ])

    const header = new Header(headerStr)
    expect(header.get('CRVAL1')).toBeCloseTo(210.801868, 6)
    expect(header.get('CRVAL2')).toBeCloseTo(54.348171, 6)
    expect(header.get('CD1_1')).toBeCloseTo(-0.0002798094, 9)
    expect(header.get('BSCALE')).toBe(1.0)
    expect(header.get('BZERO')).toBe(32768.0)
  })

  it('should handle COMMENT and HISTORY cards', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    0 / No data'),
      card('COMMENT This is a comment'),
      card('COMMENT Another comment'),
      card('HISTORY Processing step 1'),
    ])

    const header = new Header(headerStr)
    const comments = header.getComments()
    const history = header.getHistory()

    expect(comments).toHaveLength(2)
    expect(comments[0]).toBe('This is a comment')
    expect(comments[1]).toBe('Another comment')
    expect(history).toHaveLength(1)
    expect(history[0]).toBe('Processing step 1')
  })

  it('should detect extension headers', () => {
    const headerStr = makeHeaderBlock([
      card("XTENSION= 'BINTABLE'           / Binary table extension"),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    2 / Number of axes'),
      card('NAXIS1  =                   40 / Row width'),
      card('NAXIS2  =                  100 / Number of rows'),
      card('PCOUNT  =                    0 / No extra parameters'),
      card('GCOUNT  =                    1 / One group'),
      card('TFIELDS =                    2 / Number of columns'),
    ])

    const header = new Header(headerStr)
    expect(header.isPrimary()).toBe(false)
    expect(header.isExtension()).toBe(true)
    expect(header.get('XTENSION')).toBe('BINTABLE')
  })

  it('should return null for missing keywords', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    0 / No data'),
    ])

    const header = new Header(headerStr)
    expect(header.get('NONEXISTENT')).toBeNull()
    expect(header.contains('NONEXISTENT')).toBe(false)
    expect(header.contains('SIMPLE')).toBe(true)
  })

  it('should detect hasDataUnit based on NAXIS', () => {
    const noData = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                   16 / Bits per pixel'),
      card('NAXIS   =                    0 / No data'),
    ])

    const withData = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                   16 / Bits per pixel'),
      card('NAXIS   =                    2 / Two axes'),
      card('NAXIS1  =                   10 / Width'),
      card('NAXIS2  =                   10 / Height'),
    ])

    expect(new Header(noData).hasDataUnit()).toBe(false)
    expect(new Header(withData).hasDataUnit()).toBe(true)
  })

  it('should calculate data length correctly', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                   16 / Bits per pixel'),
      card('NAXIS   =                    2 / Two axes'),
      card('NAXIS1  =                  100 / Width'),
      card('NAXIS2  =                  200 / Height'),
    ])

    const header = new Header(headerStr)
    // 100 * 200 * 2 bytes = 40000
    expect(header.getDataLength()).toBe(40000)
  })

  it('should determine data types correctly', () => {
    // Image type
    const imageHeader = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                   16 / Bits per pixel'),
      card('NAXIS   =                    2 / Two axes'),
      card('NAXIS1  =                   10 / Width'),
      card('NAXIS2  =                   10 / Height'),
    ])
    expect(new Header(imageHeader).getDataType()).toBe('Image')

    // No data
    const emptyHeader = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                   16 / Bits per pixel'),
      card('NAXIS   =                    0 / No data'),
    ])
    expect(new Header(emptyHeader).getDataType()).toBeNull()
  })

  it('should return all keys', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    0 / No data'),
      card("OBJECT  = 'NGC 1234'           / Object name"),
    ])

    const header = new Header(headerStr)
    const keys = header.keys()
    expect(keys).toContain('SIMPLE')
    expect(keys).toContain('BITPIX')
    expect(keys).toContain('NAXIS')
    expect(keys).toContain('OBJECT')
  })

  it('should validate BITPIX values', () => {
    expect(() => {
      new Header(
        makeHeaderBlock([
          card('SIMPLE  =                    T / Standard FITS'),
          card('BITPIX  =                   12 / Invalid BITPIX'),
          card('NAXIS   =                    0 / No data'),
        ]),
      )
    }).toThrow('BITPIX')
  })

  it('should handle scientific notation', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                  -32 / Bits per pixel'),
      card('NAXIS   =                    2 / Two axes'),
      card('NAXIS1  =                   10 / Width'),
      card('NAXIS2  =                   10 / Height'),
      card('AMDX4   =   -2.36321927229e-05 / Coefficient'),
    ])

    const header = new Header(headerStr)
    expect(header.get('AMDX4')).toBeCloseTo(-2.36321927229e-5, 14)
  })

  it('should return false from hasDataUnit when NAXIS>0 but all NAXISn are 0', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                   16 / Bits per pixel'),
      card('NAXIS   =                    2 / Two axes'),
      card('NAXIS1  =                    0 / Width zero'),
      card('NAXIS2  =                    0 / Height zero'),
    ])
    const header = new Header(headerStr)
    expect(header.hasDataUnit()).toBe(false)
    expect(header.getDataLength()).toBe(0)
  })

  it('should detect TABLE extension type', () => {
    const headerStr = makeHeaderBlock([
      card("XTENSION= 'TABLE   '           / ASCII table extension"),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    2 / Number of axes'),
      card('NAXIS1  =                   24 / Row width'),
      card('NAXIS2  =                    3 / Number of rows'),
      card('PCOUNT  =                    0 / No extra parameters'),
      card('GCOUNT  =                    1 / One group'),
      card('TFIELDS =                    2 / Number of columns'),
    ])
    const header = new Header(headerStr)
    expect(header.getDataType()).toBe('Table')
  })

  it('should detect CompressedImage (BINTABLE + ZIMAGE)', () => {
    const headerStr = makeHeaderBlock([
      card("XTENSION= 'BINTABLE'           / Binary table extension"),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    2 / Number of axes'),
      card('NAXIS1  =                   16 / Row width'),
      card('NAXIS2  =                   10 / Number of rows'),
      card('PCOUNT  =                    0 / No extra parameters'),
      card('GCOUNT  =                    1 / One group'),
      card('TFIELDS =                    1 / Fields'),
      card('ZIMAGE  =                    T / Compressed image'),
      card("ZCMPTYPE= 'RICE_1  '           / Compression type"),
    ])
    const header = new Header(headerStr)
    expect(header.getDataType()).toBe('CompressedImage')
  })

  it('should set value with set() method', () => {
    const headerStr = makeHeaderBlock([
      card('SIMPLE  =                    T / Standard FITS'),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    0 / No data'),
    ])
    const header = new Header(headerStr)
    header.set('CUSTOM', 42, 'My custom keyword')
    expect(header.get('CUSTOM')).toBe(42)
    expect(header.contains('CUSTOM')).toBe(true)
  })

  it('should include PCOUNT in data length for BINTABLE', () => {
    const headerStr = makeHeaderBlock([
      card("XTENSION= 'BINTABLE'           / Binary table extension"),
      card('BITPIX  =                    8 / Bits per pixel'),
      card('NAXIS   =                    2 / Number of axes'),
      card('NAXIS1  =                    8 / Row width'),
      card('NAXIS2  =                   10 / Number of rows'),
      card('PCOUNT  =                  100 / Heap size'),
      card('GCOUNT  =                    1 / One group'),
      card('TFIELDS =                    1 / Fields'),
    ])
    const header = new Header(headerStr)
    // 8 * 10 + 100 = 180
    expect(header.getDataLength()).toBe(180)
  })
})
