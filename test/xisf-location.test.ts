import { describe, expect, it } from 'vitest'
import { XISFParseError, XISFValidationError } from '../src/xisf-errors'
import {
  parseChecksumSpec,
  parseCompressionSpec,
  parseCompressionSubblocks,
  parseXISFLocation,
  resolveHeaderRelativePath,
} from '../src/xisf-location'

describe('xisf-location', () => {
  it('parses inline, embedded, attachment and attached locations', () => {
    expect(parseXISFLocation('inline:base64')).toEqual({ type: 'inline', encoding: 'base64' })
    expect(parseXISFLocation('inline:hex')).toEqual({ type: 'inline', encoding: 'hex' })
    expect(parseXISFLocation('embedded')).toEqual({ type: 'embedded' })
    expect(parseXISFLocation('attachment:12:34')).toEqual({
      type: 'attachment',
      position: 12,
      size: 34,
    })
    expect(parseXISFLocation('attached:1:2')).toEqual({ type: 'attachment', position: 1, size: 2 })
  })

  it('parses url/path syntax and optional index ids', () => {
    expect(parseXISFLocation('url(https://example.test/p):0x10')).toEqual({
      type: 'url',
      url: 'https://example.test/p',
      indexId: BigInt(16),
    })
    expect(parseXISFLocation('path(C:/data/blocks.xisb):42')).toEqual({
      type: 'path',
      path: 'C:/data/blocks.xisb',
      indexId: BigInt(42),
    })
    expect(parseXISFLocation('path(relative/file)')).toEqual({
      type: 'path',
      path: 'relative/file',
      indexId: undefined,
    })
    expect(parseXISFLocation('url(https://example.test/p):   ')).toEqual({
      type: 'url',
      url: 'https://example.test/p',
      indexId: undefined,
    })
  })

  it('rejects invalid location syntax and invalid attachment numbers', () => {
    expect(() => parseXISFLocation('inline:utf16')).toThrow(XISFParseError)
    expect(() => parseXISFLocation('attachment:1')).toThrow(XISFParseError)
    expect(() => parseXISFLocation('attachment:-1:3')).toThrow(XISFParseError)
    expect(() => parseXISFLocation('unknown:schema')).toThrow(XISFParseError)
  })

  it('parses compression subblocks and validates entries', () => {
    expect(parseCompressionSubblocks('')).toEqual([])
    expect(parseCompressionSubblocks('10,20:30,40')).toEqual([
      { compressedSize: 10, uncompressedSize: 20 },
      { compressedSize: 30, uncompressedSize: 40 },
    ])
    expect(() => parseCompressionSubblocks('10')).toThrow(XISFParseError)
    expect(() => parseCompressionSubblocks('10,-1')).toThrow(XISFParseError)
  })

  it('parses checksum/compression specs and rejects malformed values', () => {
    expect(parseChecksumSpec('sha256:ABCD')).toEqual({ algorithm: 'sha256', digest: 'abcd' })
    expect(() => parseChecksumSpec('sha256')).toThrow(XISFParseError)

    expect(parseCompressionSpec('zlib:1024')).toEqual({ codec: 'zlib', uncompressedSize: 1024 })
    expect(parseCompressionSpec('zlib+sh:2048:2')).toEqual({
      codec: 'zlib+sh',
      uncompressedSize: 2048,
      itemSize: 2,
    })
    expect(() => parseCompressionSpec('zlib')).toThrow(XISFParseError)
    expect(() => parseCompressionSpec('zlib:-1')).toThrow(XISFParseError)
    expect(() => parseCompressionSpec('zlib:10:0')).toThrow(XISFParseError)
  })

  it('resolves @header_dir paths for url and file-system contexts', () => {
    expect(resolveHeaderRelativePath('plain/path', 'C:/base')).toBe('plain/path')
    expect(resolveHeaderRelativePath('@header_dir/blocks.xisb', 'https://example.test/dir')).toBe(
      'https://example.test/dir/blocks.xisb',
    )
    expect(resolveHeaderRelativePath('@header_dir/blocks.xisb', 'C:\\tmp\\data\\')).toBe(
      'C:/tmp/data/blocks.xisb',
    )
    expect(() => resolveHeaderRelativePath('@header_dir/blocks.xisb')).toThrow(XISFValidationError)
  })
})
