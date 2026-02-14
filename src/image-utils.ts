import type { TypedArray } from './types'

/**
 * Compute the minimum and maximum pixel values in a typed array,
 * ignoring NaN values.
 *
 * @returns A tuple [min, max], or [NaN, NaN] if all values are NaN.
 */
export function getExtent(arr: TypedArray | Float32Array): [number, number] {
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
): number {
  const index = y * width + x
  if (index < 0 || index >= arr.length) {
    return NaN
  }
  return arr[index]!
}
