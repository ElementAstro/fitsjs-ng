import { describe, it, expect } from 'vitest'
import { DataUnit } from '../src/data-unit'
import { swapEndian } from '../src/utils'

describe('DataUnit', () => {
  it('should store ArrayBuffer when constructed with ArrayBuffer', () => {
    const buf = new ArrayBuffer(16)
    const du = new DataUnit(buf)
    expect(du.buffer).toBe(buf)
    expect(du.blob).toBeUndefined()
  })

  it('should store Blob when constructed with Blob', () => {
    const blob = new Blob([new Uint8Array(16)])
    const du = new DataUnit(blob)
    expect(du.blob).toBe(blob)
    expect(du.buffer).toBeUndefined()
  })

  it('should expose static swapEndian functions', () => {
    expect(DataUnit.swapEndian).toBe(swapEndian)
    expect(DataUnit.swapEndian[8]!(42)).toBe(42)
  })
})
