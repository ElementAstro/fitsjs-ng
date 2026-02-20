import { describe, it, expect } from 'vitest'
import { FITSError, HeaderError, DataError, DecompressionError } from '../../src/core/errors'

describe('Error Classes', () => {
  it('FITSError should be an instance of Error', () => {
    const err = new FITSError('test')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(FITSError)
    expect(err.name).toBe('FITSError')
    expect(err.message).toBe('test')
  })

  it('HeaderError should extend FITSError', () => {
    const err = new HeaderError('bad header')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(FITSError)
    expect(err).toBeInstanceOf(HeaderError)
    expect(err.name).toBe('HeaderError')
    expect(err.message).toBe('bad header')
  })

  it('DataError should extend FITSError', () => {
    const err = new DataError('bad data')
    expect(err).toBeInstanceOf(FITSError)
    expect(err.name).toBe('DataError')
    expect(err.message).toBe('bad data')
  })

  it('DecompressionError should extend FITSError', () => {
    const err = new DecompressionError('decompress failed')
    expect(err).toBeInstanceOf(FITSError)
    expect(err.name).toBe('DecompressionError')
    expect(err.message).toBe('decompress failed')
  })

  it('errors should be catchable as FITSError', () => {
    try {
      throw new HeaderError('catch me')
    } catch (e) {
      expect(e).toBeInstanceOf(FITSError)
    }
  })
})
