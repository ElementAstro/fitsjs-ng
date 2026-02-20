import { describe, expect, it } from 'vitest'
import { FITSError } from '../../src/core/errors'
import {
  SERConversionError,
  SERError,
  SERParseError,
  SERValidationError,
} from '../../src/ser/ser-errors'

describe('ser/ser-errors', () => {
  it('preserves class hierarchy and names', () => {
    const parseError = new SERParseError('parse')
    const validationError = new SERValidationError('validate')
    const conversionError = new SERConversionError('convert')

    expect(parseError).toBeInstanceOf(SERError)
    expect(parseError).toBeInstanceOf(FITSError)
    expect(parseError.name).toBe('SERParseError')

    expect(validationError).toBeInstanceOf(SERError)
    expect(validationError.name).toBe('SERValidationError')

    expect(conversionError).toBeInstanceOf(SERError)
    expect(conversionError.name).toBe('SERConversionError')
  })
})
