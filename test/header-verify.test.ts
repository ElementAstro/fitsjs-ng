import { describe, it, expect } from 'vitest'
import { Header } from '../src/header'
import { HeaderError } from '../src/errors'
import { makeHeaderBlock, card } from './helpers'

describe('Header Verification', () => {
  function makeHeader(cards: string[]): Header {
    return new Header(makeHeaderBlock(cards))
  }

  describe('SIMPLE keyword', () => {
    it('should set primary = true and convert T to boolean true', () => {
      const header = makeHeader([
        card('SIMPLE  =                    T / Standard FITS'),
        card('BITPIX  =                    8 / Bits per pixel'),
        card('NAXIS   =                    0 / No data'),
      ])
      expect(header.isPrimary()).toBe(true)
      expect(header.get('SIMPLE')).toBe(true)
    })

    it('should set primary = true and convert F to boolean false', () => {
      const header = makeHeader([
        card('SIMPLE  =                    F / Non-standard'),
        card('BITPIX  =                    8 / Bits per pixel'),
        card('NAXIS   =                    0 / No data'),
      ])
      expect(header.isPrimary()).toBe(true)
      expect(header.get('SIMPLE')).toBe(false)
    })
  })

  describe('XTENSION keyword', () => {
    it('should set extension = true and store extension type', () => {
      const header = makeHeader([
        card("XTENSION= 'IMAGE   '           / Image extension"),
        card('BITPIX  =                   16 / Bits per pixel'),
        card('NAXIS   =                    2 / Number of axes'),
        card('NAXIS1  =                   10 / Width'),
        card('NAXIS2  =                   10 / Height'),
        card('PCOUNT  =                    0 / No extra parameters'),
        card('GCOUNT  =                    1 / One group'),
      ])
      expect(header.isExtension()).toBe(true)
      expect(header.get('XTENSION')).toBe('IMAGE')
    })
  })

  describe('BITPIX keyword', () => {
    it('should accept valid BITPIX values', () => {
      for (const bp of [8, 16, 32, -32, -64]) {
        const bpStr = bp >= 0 ? `${bp}`.padStart(20) : `${bp}`.padStart(20)
        const header = makeHeader([
          card(`SIMPLE  =                    T / Standard FITS`),
          card(`BITPIX  = ${bpStr} / Bits`),
          card(`NAXIS   =                    0 / No data`),
        ])
        expect(header.get('BITPIX')).toBe(bp)
      }
    })

    it('should reject invalid BITPIX values', () => {
      expect(() =>
        makeHeader([
          card('SIMPLE  =                    T / Standard FITS'),
          card('BITPIX  =                   24 / Invalid'),
          card('NAXIS   =                    0 / No data'),
        ]),
      ).toThrow(HeaderError)
    })
  })

  describe('NAXIS keyword', () => {
    it('should reject NAXIS out of range', () => {
      expect(() =>
        makeHeader([
          card('SIMPLE  =                    T / Standard FITS'),
          card('BITPIX  =                    8 / Bits per pixel'),
          card('NAXIS   =                 1000 / Too many axes'),
        ]),
      ).toThrow(HeaderError)
    })

    it('should reject NAXIS != 2 for BINTABLE extensions', () => {
      expect(() =>
        makeHeader([
          card("XTENSION= 'BINTABLE'           / Binary table"),
          card('BITPIX  =                    8 / Bits per pixel'),
          card('NAXIS   =                    3 / Wrong for table'),
        ]),
      ).toThrow(HeaderError)
    })
  })

  describe('PCOUNT keyword', () => {
    it('should reject non-zero PCOUNT for IMAGE extensions', () => {
      expect(() =>
        makeHeader([
          card("XTENSION= 'IMAGE   '           / Image extension"),
          card('BITPIX  =                   16 / Bits per pixel'),
          card('NAXIS   =                    2 / Number of axes'),
          card('NAXIS1  =                   10 / Width'),
          card('NAXIS2  =                   10 / Height'),
          card('PCOUNT  =                    5 / Wrong for IMAGE'),
          card('GCOUNT  =                    1 / One group'),
        ]),
      ).toThrow(HeaderError)
    })
  })

  describe('GCOUNT keyword', () => {
    it('should reject non-1 GCOUNT for extensions', () => {
      expect(() =>
        makeHeader([
          card("XTENSION= 'BINTABLE'           / Binary table"),
          card('BITPIX  =                    8 / Bits per pixel'),
          card('NAXIS   =                    2 / Number of axes'),
          card('NAXIS1  =                   10 / Width'),
          card('NAXIS2  =                    5 / Rows'),
          card('PCOUNT  =                    0 / No extra'),
          card('GCOUNT  =                    2 / Wrong'),
        ]),
      ).toThrow(HeaderError)
    })
  })

  describe('EXTEND keyword', () => {
    it('should reject EXTEND in non-primary header', () => {
      expect(() =>
        makeHeader([
          card("XTENSION= 'IMAGE   '           / Extension"),
          card('BITPIX  =                   16 / Bits per pixel'),
          card('NAXIS   =                    2 / Number of axes'),
          card('NAXIS1  =                   10 / Width'),
          card('NAXIS2  =                   10 / Height'),
          card('PCOUNT  =                    0 / No extra'),
          card('GCOUNT  =                    1 / One group'),
          card('EXTEND  =                    T / Not allowed'),
        ]),
      ).toThrow(HeaderError)
    })
  })

  describe('TFIELDS keyword', () => {
    it('should reject TFIELDS out of range', () => {
      expect(() =>
        makeHeader([
          card("XTENSION= 'BINTABLE'           / Binary table"),
          card('BITPIX  =                    8 / Bits per pixel'),
          card('NAXIS   =                    2 / Number of axes'),
          card('NAXIS1  =                   10 / Width'),
          card('NAXIS2  =                    5 / Rows'),
          card('PCOUNT  =                    0 / No extra'),
          card('GCOUNT  =                    1 / One group'),
          card('TFIELDS =                 1000 / Too many'),
        ]),
      ).toThrow(HeaderError)
    })
  })

  describe('ZCMPTYPE keyword', () => {
    it('should accept RICE_1', () => {
      const header = makeHeader([
        card("XTENSION= 'BINTABLE'           / Binary table"),
        card('BITPIX  =                    8 / Bits per pixel'),
        card('NAXIS   =                    2 / Number of axes'),
        card('NAXIS1  =                   10 / Width'),
        card('NAXIS2  =                    5 / Rows'),
        card('PCOUNT  =                    0 / No extra'),
        card('GCOUNT  =                    1 / One group'),
        card('TFIELDS =                    1 / Fields'),
        card("ZCMPTYPE= 'RICE_1  '           / Compression"),
      ])
      expect(header.get('ZCMPTYPE')).toBe('RICE_1')
    })

    it('should reject unsupported compression types', () => {
      expect(() =>
        makeHeader([
          card("XTENSION= 'BINTABLE'           / Binary table"),
          card('BITPIX  =                    8 / Bits per pixel'),
          card('NAXIS   =                    2 / Number of axes'),
          card('NAXIS1  =                   10 / Width'),
          card('NAXIS2  =                    5 / Rows'),
          card('PCOUNT  =                    0 / No extra'),
          card('GCOUNT  =                    1 / One group'),
          card('TFIELDS =                    1 / Fields'),
          card("ZCMPTYPE= 'GZIP_1  '           / Not implemented"),
        ]),
      ).toThrow(HeaderError)
    })

    it('should reject invalid compression type names', () => {
      expect(() =>
        makeHeader([
          card("XTENSION= 'BINTABLE'           / Binary table"),
          card('BITPIX  =                    8 / Bits per pixel'),
          card('NAXIS   =                    2 / Number of axes'),
          card('NAXIS1  =                   10 / Width'),
          card('NAXIS2  =                    5 / Rows'),
          card('PCOUNT  =                    0 / No extra'),
          card('GCOUNT  =                    1 / One group'),
          card('TFIELDS =                    1 / Fields'),
          card("ZCMPTYPE= 'INVALID '           / Bad compression"),
        ]),
      ).toThrow(HeaderError)
    })
  })

  describe('ZBITPIX keyword', () => {
    it('should reject invalid ZBITPIX values', () => {
      expect(() =>
        makeHeader([
          card('SIMPLE  =                    T / Standard FITS'),
          card('BITPIX  =                    8 / Bits per pixel'),
          card('NAXIS   =                    0 / No data'),
          card('ZBITPIX =                   24 / Invalid'),
        ]),
      ).toThrow(HeaderError)
    })
  })

  describe('BSCALE / BZERO / DATAMIN / DATAMAX', () => {
    it('should parse numeric values', () => {
      const header = makeHeader([
        card('SIMPLE  =                    T / Standard FITS'),
        card('BITPIX  =                   16 / Bits per pixel'),
        card('NAXIS   =                    2 / Number of axes'),
        card('NAXIS1  =                    4 / Width'),
        card('NAXIS2  =                    4 / Height'),
        card('BSCALE  =                  1.5 / Scale'),
        card('BZERO   =               -100.0 / Zero'),
        card('DATAMIN =                  0.0 / Min'),
        card('DATAMAX =                255.0 / Max'),
      ])
      expect(header.get('BSCALE')).toBe(1.5)
      expect(header.get('BZERO')).toBe(-100.0)
      expect(header.get('DATAMIN')).toBe(0.0)
      expect(header.get('DATAMAX')).toBe(255.0)
    })
  })
})
