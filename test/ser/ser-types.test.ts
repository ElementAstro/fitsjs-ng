import { describe, expect, it } from 'vitest'
import {
  SER_BAYER_OR_CMY_PATTERN,
  SER_COLOR_CHANNELS,
  SER_FILE_ID,
  SER_HEADER_LENGTH,
  SER_SUPPORTED_COLOR_IDS,
  SER_TICKS_AT_UNIX_EPOCH,
} from '../../src/ser/ser-types'

describe('ser/ser-types', () => {
  it('defines file-level SER constants', () => {
    expect(SER_HEADER_LENGTH).toBe(178)
    expect(SER_FILE_ID).toBe('LUCAM-RECORDER')
    expect(SER_TICKS_AT_UNIX_EPOCH).toBe(621355968000000000n)
  })

  it('maps color ids to channel counts and CFA patterns', () => {
    expect(SER_SUPPORTED_COLOR_IDS).toContain(0)
    expect(SER_SUPPORTED_COLOR_IDS).toContain(100)
    expect(SER_COLOR_CHANNELS[0]).toBe(1)
    expect(SER_COLOR_CHANNELS[100]).toBe(3)
    expect(SER_BAYER_OR_CMY_PATTERN[8]).toBe('RGGB')
    expect(SER_BAYER_OR_CMY_PATTERN[11]).toBe('BGGR')
  })
})
