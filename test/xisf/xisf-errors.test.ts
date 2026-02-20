import { describe, expect, it } from 'vitest'
import { FITSError } from '../../src/core/errors'
import {
  XISFChecksumError,
  XISFCompressionError,
  XISFConversionError,
  XISFError,
  XISFParseError,
  XISFResourceError,
  XISFSignatureError,
  XISFValidationError,
} from '../../src/xisf/xisf-errors'

describe('xisf-errors', () => {
  it('sets names and inheritance correctly for all XISF error classes', () => {
    const instances = [
      new XISFError('base'),
      new XISFParseError('parse'),
      new XISFValidationError('validation'),
      new XISFResourceError('resource'),
      new XISFCompressionError('compression'),
      new XISFChecksumError('checksum'),
      new XISFSignatureError('signature'),
      new XISFConversionError('conversion'),
    ]

    for (const err of instances) {
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(FITSError)
      expect(err).toBeInstanceOf(XISFError)
      expect(err.message.length).toBeGreaterThan(0)
      expect(err.name.startsWith('XISF')).toBe(true)
    }
  })
})
