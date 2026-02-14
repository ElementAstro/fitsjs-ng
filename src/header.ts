import type { CardValue, HeaderCard, DataUnitType, ExtensionType, WarningCallback } from './types'
import { DEFAULT_MAX_HEADER_LINES } from './constants'
import { HeaderError } from './errors'
import { VerifyFns, type VerifyContext } from './header-verify'

/**
 * Represents a parsed FITS header.
 *
 * A FITS header consists of 80-character card images containing
 * keyword = value / comment triplets.
 */
export class Header implements VerifyContext {
  private static readonly ARRAY_PATTERN = /(\D+)(\d+)/

  /** Whether this is a primary header (contains SIMPLE keyword). */
  primary = false
  /** Whether this is an extension header (contains XTENSION keyword). */
  extension = false
  /** The extension type if this is an extension header. */
  extensionType?: ExtensionType

  /** Storage for parsed header cards, keyed by keyword. */
  private cards: Map<string, HeaderCard> = new Map()
  /** Storage for COMMENT cards. */
  private comments: string[] = []
  /** Storage for HISTORY cards. */
  private history: string[] = []
  /** Running index of the current card being parsed. */
  cardIndex = 0

  /** Warning callback for non-fatal issues during parsing. */
  warn: WarningCallback

  /** Maximum number of header lines to parse. */
  private maxLines: number

  /** The raw header block string, preserved for reference. */
  readonly block: string

  constructor(
    block: string,
    maxLines: number = DEFAULT_MAX_HEADER_LINES,
    onWarning?: WarningCallback,
  ) {
    this.maxLines = maxLines
    this.warn = onWarning ?? console.warn
    this.block = block
    this.readBlock(block)
  }

  /**
   * Get the value for a header keyword.
   * Returns `null` if the keyword is not present.
   */
  get(key: string): CardValue {
    if (this.contains(key)) {
      return this.cards.get(key)!.value
    }
    return null
  }

  /**
   * Get a numeric value for a header keyword.
   * Returns the `fallback` (default `0`) if the keyword is missing.
   * Throws `HeaderError` if the value is present but not a number.
   */
  getNumber(key: string, fallback?: number): number {
    const value = this.get(key)
    if (value === null) return fallback ?? 0
    if (typeof value === 'number') return value
    throw new HeaderError(`Expected number for keyword ${key}, got ${typeof value}`)
  }

  /**
   * Get a string value for a header keyword.
   * Returns the `fallback` (default `''`) if the keyword is missing.
   * Throws `HeaderError` if the value is present but not a string.
   */
  getString(key: string, fallback?: string): string {
    const value = this.get(key)
    if (value === null) return fallback ?? ''
    if (typeof value === 'string') return value
    throw new HeaderError(`Expected string for keyword ${key}, got ${typeof value}`)
  }

  /**
   * Get a boolean value for a header keyword.
   * Returns the `fallback` (default `false`) if the keyword is missing.
   * Throws `HeaderError` if the value is present but not a boolean.
   */
  getBoolean(key: string, fallback?: boolean): boolean {
    const value = this.get(key)
    if (value === null) return fallback ?? false
    if (typeof value === 'boolean') return value
    throw new HeaderError(`Expected boolean for keyword ${key}, got ${typeof value}`)
  }

  /**
   * Set a keyword with a value and optional comment.
   */
  set(key: string, value: CardValue, comment: string = ''): void {
    this.cards.set(key, {
      index: this.cardIndex,
      value,
      comment,
    })
    this.cardIndex += 1
  }

  /**
   * Check if the header contains a specific keyword.
   */
  contains(key: string): boolean {
    return this.cards.has(key)
  }

  /**
   * Get all COMMENT card values.
   */
  getComments(): string[] {
    return this.comments
  }

  /**
   * Get all HISTORY card values.
   */
  getHistory(): string[] {
    return this.history
  }

  /**
   * Returns all keyword names in insertion order.
   */
  keys(): string[] {
    return Array.from(this.cards.keys())
  }

  /**
   * Determine if this header has an associated data unit based on NAXIS.
   */
  hasDataUnit(): boolean {
    const naxis = this.getNumber('NAXIS')
    if (naxis === 0) return false
    for (let i = 1; i <= naxis; i++) {
      if (this.getNumber(`NAXIS${i}`) !== 0) return true
    }
    return false
  }

  /**
   * Calculate the byte length of the associated data unit.
   */
  getDataLength(): number {
    if (!this.hasDataUnit()) {
      return 0
    }

    const naxis = this.getNumber('NAXIS')
    const naxisValues: number[] = []
    for (let i = 1; i <= naxis; i++) {
      naxisValues.push(this.getNumber(`NAXIS${i}`))
    }

    const bitpix = this.getNumber('BITPIX')
    let length = (naxisValues.reduce((a, b) => a * b, 1) * Math.abs(bitpix)) / 8
    length += this.getNumber('PCOUNT')

    return length
  }

  /**
   * Determine the data unit type from header keywords.
   */
  getDataType(): DataUnitType | null {
    switch (this.extensionType) {
      case 'BINTABLE':
        if (this.contains('ZIMAGE')) return 'CompressedImage'
        return 'BinaryTable'
      case 'TABLE':
        return 'Table'
      case 'IMAGE':
        if (this.hasDataUnit()) return 'Image'
        return null
      default:
        if (this.hasDataUnit()) return 'Image'
        return null
    }
  }

  /** Check if this is a primary header. */
  isPrimary(): boolean {
    return this.primary
  }

  /** Check if this is an extension header. */
  isExtension(): boolean {
    return this.extension
  }

  // --- Private parsing methods ---

  private readBlock(block: string): void {
    const lineWidth = 80
    const nLinesRaw = block.length / lineWidth
    const nLines = Math.min(nLinesRaw, this.maxLines)

    for (let i = 0; i < nLines; i++) {
      const line = block.slice(i * lineWidth, (i + 1) * lineWidth)
      this.readLine(line)
    }
  }

  private readLine(line: string): void {
    // Check bytes 1 to 8 for key or whitespace
    const key = line.slice(0, 8).trim()
    if (key === '') return

    // Get indicator and value portion
    const indicator = line.slice(8, 10)
    const rawValue = line.slice(10)

    // Check the indicator
    if (indicator !== '= ') {
      // Key will be either COMMENT, HISTORY, or END
      // For COMMENT/HISTORY, the value is everything after the keyword (pos 8)
      const fullValue = line.slice(8).trim()
      if (key === 'COMMENT') {
        this.comments.push(fullValue)
      } else if (key === 'HISTORY') {
        this.history.push(fullValue)
      }
      return
    }

    // Split value from comment (comment starts with ' /')
    // Must not match ' /' inside quoted string values
    let valueStr: string
    let comment: string
    if (rawValue.trimStart().startsWith("'")) {
      // String value — find closing quote, skipping escaped quotes ('')
      const openQuote = rawValue.indexOf("'")
      let closeQuote = -1
      let pos = openQuote + 1
      while (pos < rawValue.length) {
        const q = rawValue.indexOf("'", pos)
        if (q === -1) break
        // Check if this is an escaped quote (followed by another quote)
        if (q + 1 < rawValue.length && rawValue[q + 1] === "'") {
          pos = q + 2 // Skip the escaped pair
          continue
        }
        closeQuote = q
        break
      }
      if (closeQuote !== -1) {
        const afterQuote = rawValue.slice(closeQuote + 1)
        const slashIdx = afterQuote.indexOf(' /')
        if (slashIdx !== -1) {
          valueStr = rawValue.slice(0, closeQuote + 1).trim()
          comment = afterQuote.slice(slashIdx + 2).trim()
        } else {
          valueStr = rawValue.slice(0, closeQuote + 1).trim()
          comment = ''
        }
      } else {
        valueStr = rawValue.trim()
        comment = ''
      }
    } else {
      const slashIdx = rawValue.indexOf(' /')
      if (slashIdx !== -1) {
        valueStr = rawValue.slice(0, slashIdx).trim()
        comment = rawValue.slice(slashIdx + 2).trim()
      } else {
        valueStr = rawValue.trim()
        comment = ''
      }
    }

    // Parse the value
    let value: CardValue
    if (valueStr.startsWith("'")) {
      // String data type — strip surrounding quotes and unescape doubled quotes
      value = valueStr.slice(1, -1).replaceAll("''", "'").trim()
    } else if (valueStr === 'T' || valueStr === 'F') {
      // Boolean — leave as string for verification functions to handle
      value = valueStr
    } else {
      // Numeric
      value = parseFloat(valueStr)
    }

    // Validate against reserved keyword rules
    value = this.validate(key, value)

    this.set(key, value, comment)
  }

  private validate(key: string, value: CardValue): CardValue {
    let baseKey = key
    let isArray = false
    let index: string | undefined

    const match = Header.ARRAY_PATTERN.exec(key)
    if (match) {
      isArray = true
      baseKey = match[1]!
      index = match[2]
    }

    if (baseKey in VerifyFns) {
      value = VerifyFns[baseKey]!(this, value, isArray, index)
    }

    return value
  }
}
