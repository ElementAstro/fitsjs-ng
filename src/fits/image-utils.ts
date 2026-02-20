import type { TypedArray } from '../core/types'

function isBigIntTypedArray(arr: TypedArray | Float32Array): arr is BigInt64Array | BigUint64Array {
  return arr instanceof BigInt64Array || arr instanceof BigUint64Array
}

/**
 * Compute the minimum and maximum pixel values in a typed array,
 * ignoring NaN values.
 *
 * @returns A tuple [min, max], or [NaN, NaN] if all values are NaN.
 */
export function getExtent(arr: TypedArray | Float32Array): [number | bigint, number | bigint] {
  if (isBigIntTypedArray(arr)) {
    if (arr.length === 0) return [NaN, NaN]
    let min = arr[0]!
    let max = arr[0]!
    for (let i = 1; i < arr.length; i++) {
      const value = arr[i]!
      if (value < min) min = value
      else if (value > max) max = value
    }
    return [min, max]
  }

  const len = arr.length
  let min: number | undefined
  let max: number | undefined
  let i = 0

  // Find first non-NaN value
  for (; i < len; i++) {
    const value = arr[i]!
    if (!isNaN(value)) {
      min = max = value
      i++
      break
    }
  }

  if (min === undefined || max === undefined) {
    return [NaN, NaN]
  }

  // Continue forward loop to find extent
  for (; i < len; i++) {
    const value = arr[i]!
    if (isNaN(value)) continue
    if (value < min) min = value
    else if (value > max) max = value
  }

  return [min, max]
}

/**
 * Get a single pixel value from a flat array given x, y coordinates and image width.
 */
export function getPixel(
  arr: TypedArray | Float32Array,
  x: number,
  y: number,
  width: number,
): number | bigint {
  const index = y * width + x
  if (index < 0 || index >= arr.length) {
    return NaN
  }
  return arr[index]!
}
