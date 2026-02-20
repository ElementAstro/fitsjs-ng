import { describe, expect, it } from 'vitest'
import {
  BLOCK_LENGTH,
  DEFAULT_MAX_HEADER_LINES,
  LINE_WIDTH,
  LINES_PER_BLOCK,
  N_RANDOM,
  NULL_VALUE,
  VERSION,
  ZERO_VALUE,
} from '../../src/core/constants'

describe('core/constants', () => {
  it('exposes expected FITS constants', () => {
    expect(LINE_WIDTH).toBe(80)
    expect(BLOCK_LENGTH).toBe(2880)
    expect(LINES_PER_BLOCK).toBe(BLOCK_LENGTH / LINE_WIDTH)
    expect(DEFAULT_MAX_HEADER_LINES).toBe(600)
    expect(NULL_VALUE).toBe(-2147483647)
    expect(ZERO_VALUE).toBe(-2147483646)
    expect(N_RANDOM).toBe(10000)
  })

  it('injects test build version', () => {
    expect(VERSION).toBe('0.0.1-test')
  })
})
