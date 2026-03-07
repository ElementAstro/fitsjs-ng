import { describe, it, expect } from 'vitest'
import { DataUnit } from '../../src/fits/data-unit'
import { swapEndian } from '../../src/core/utils'

describe('DataUnit', () => {
  it('should store ArrayBuffer when constructed with ArrayBuffer', () => {
    const buf = new ArrayBuffer(16)
    const du = new DataUnit(buf)
    expect(du.buffer).toBe(buf)
    expect(du.blob).toBeUndefined()
  })

  it('should store ArrayBuffer views with correct byte range', () => {
    const parent = new ArrayBuffer(10)
    const parentView = new Uint8Array(parent)
    for (let i = 0; i < parentView.length; i++) parentView[i] = i

    const slice = new Uint8Array(parent, 2, 4) // [2,3,4,5]
    const du = new DataUnit(slice)

    expect(du.buffer).toBe(parent)
    expect(du.blob).toBeUndefined()
    expect(Array.from(du.getByteView())).toEqual([2, 3, 4, 5])
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
