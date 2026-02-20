import { FITSError } from '../core/errors'

export class XISFError extends FITSError {
  constructor(message: string) {
    super(message)
    this.name = 'XISFError'
  }
}

export class XISFParseError extends XISFError {
  constructor(message: string) {
    super(message)
    this.name = 'XISFParseError'
  }
}

export class XISFValidationError extends XISFError {
  constructor(message: string) {
    super(message)
    this.name = 'XISFValidationError'
  }
}

export class XISFResourceError extends XISFError {
  constructor(message: string) {
    super(message)
    this.name = 'XISFResourceError'
  }
}

export class XISFCompressionError extends XISFError {
  constructor(message: string) {
    super(message)
    this.name = 'XISFCompressionError'
  }
}

export class XISFChecksumError extends XISFError {
  constructor(message: string) {
    super(message)
    this.name = 'XISFChecksumError'
  }
}

export class XISFSignatureError extends XISFError {
  constructor(message: string) {
    super(message)
    this.name = 'XISFSignatureError'
  }
}

export class XISFConversionError extends XISFError {
  constructor(message: string) {
    super(message)
    this.name = 'XISFConversionError'
  }
}
