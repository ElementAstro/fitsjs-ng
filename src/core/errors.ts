/**
 * Base error class for all FITS-related errors.
 */
export class FITSError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FITSError'
  }
}

/**
 * Error thrown during header parsing or validation.
 */
export class HeaderError extends FITSError {
  constructor(message: string) {
    super(message)
    this.name = 'HeaderError'
  }
}

/**
 * Error thrown during data unit reading or interpretation.
 */
export class DataError extends FITSError {
  constructor(message: string) {
    super(message)
    this.name = 'DataError'
  }
}

/**
 * Error thrown when decompression fails.
 */
export class DecompressionError extends FITSError {
  constructor(message: string) {
    super(message)
    this.name = 'DecompressionError'
  }
}
