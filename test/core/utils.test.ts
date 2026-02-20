import { describe, it, expect } from 'vitest'
import { swapEndian, uint8ArrayToString, excessBytes, toBits } from '../../src/core/utils'
import { BLOCK_LENGTH } from '../../src/core/constants'

describe('Utils', () => {
  describe('swapEndian', () => {
    it('should not swap 8-bit values', () => {
      expect(swapEndian[8]!(42)).toBe(42)
      expect(swapEndian['B']!(255)).toBe(255)
    })

    it('should swap 16-bit values', () => {
      // 0x0102 => 0x0201
      expect(swapEndian[16]!(0x0102) & 0xffff).toBe(0x0201)
    })

    it('should swap 32-bit values', () => {
      // 0x01020304 => 0x04030201
      expect(swapEndian[32]!(0x01020304) >>> 0).toBe(0x04030201 >>> 0)
    })
  })

  describe('uint8ArrayToString', () => {
    it('should convert ASCII bytes to string', () => {
      const arr = new Uint8Array([72, 101, 108, 108, 111])
      expect(uint8ArrayToString(arr)).toBe('Hello')
    })

    it('should handle empty array', () => {
      expect(uint8ArrayToString(new Uint8Array(0))).toBe('')
    })
  })

  describe('excessBytes', () => {
    it('should return 0 for exact block boundary', () => {
      expect(excessBytes(BLOCK_LENGTH)).toBe(0)
      expect(excessBytes(BLOCK_LENGTH * 3)).toBe(0)
    })

    it('should return correct padding for non-boundary', () => {
      expect(excessBytes(100)).toBe(BLOCK_LENGTH - 100)
      expect(excessBytes(BLOCK_LENGTH + 1)).toBe(BLOCK_LENGTH - 1)
    })

    it('should return 0 for length 0', () => {
      expect(excessBytes(0)).toBe(0)
    })
  })

  describe('toBits', () => {
    it('should convert byte to 8 bits MSB first', () => {
      expect(toBits(0b10110001)).toEqual([1, 0, 1, 1, 0, 0, 0, 1])
    })

    it('should handle 0', () => {
      expect(toBits(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    })

    it('should handle 255', () => {
      expect(toBits(255)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
    })
  })
})
