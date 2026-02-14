import { describe, it, expect } from 'vitest'
import { getExtent, getPixel } from '../src/image-utils'

describe('image-utils', () => {
  describe('getExtent', () => {
    it('should return [min, max] for a simple array', () => {
      const arr = new Float32Array([3, 1, 4, 1, 5, 9, 2, 6])
      expect(getExtent(arr)).toEqual([1, 9])
    })

    it('should ignore NaN values', () => {
      const arr = new Float32Array([NaN, 3, NaN, 1, NaN, 7, NaN])
      expect(getExtent(arr)).toEqual([1, 7])
    })

    it('should return [NaN, NaN] for all-NaN array', () => {
      const arr = new Float32Array([NaN, NaN, NaN])
      const [min, max] = getExtent(arr)
      expect(isNaN(min)).toBe(true)
      expect(isNaN(max)).toBe(true)
    })

    it('should return [NaN, NaN] for empty array', () => {
      const arr = new Float32Array(0)
      const [min, max] = getExtent(arr)
      expect(isNaN(min)).toBe(true)
      expect(isNaN(max)).toBe(true)
    })

    it('should handle single-element array', () => {
      const arr = new Float32Array([42])
      expect(getExtent(arr)).toEqual([42, 42])
    })

    it('should handle negative values', () => {
      const arr = new Float32Array([-10, -5, -20, -1])
      expect(getExtent(arr)).toEqual([-20, -1])
    })

    it('should work with Int16Array', () => {
      const arr = new Int16Array([100, -200, 300])
      expect(getExtent(arr)).toEqual([-200, 300])
    })

    it('should work with Uint8Array', () => {
      const arr = new Uint8Array([0, 128, 255])
      expect(getExtent(arr)).toEqual([0, 255])
    })
  })

  describe('getPixel', () => {
    it('should return correct pixel at (x, y) for given width', () => {
      // 3x2 image: [0,1,2, 3,4,5]
      const arr = new Float32Array([0, 1, 2, 3, 4, 5])
      const width = 3
      expect(getPixel(arr, 0, 0, width)).toBe(0)
      expect(getPixel(arr, 2, 0, width)).toBe(2)
      expect(getPixel(arr, 0, 1, width)).toBe(3)
      expect(getPixel(arr, 2, 1, width)).toBe(5)
      expect(getPixel(arr, 1, 1, width)).toBe(4)
    })
  })
})
