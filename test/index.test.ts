import { describe, it, expect } from 'vitest'
import { greet } from '../src/index'

describe('greet', () => {
  it('should return greeting message', () => {
    expect(greet('World')).toBe('Hello, World!')
  })

  it('should handle empty string', () => {
    expect(greet('')).toBe('Hello, !')
  })
})
