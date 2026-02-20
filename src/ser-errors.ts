import { FITSError } from './errors'

export class SERError extends FITSError {
  constructor(message: string) {
    super(message)
    this.name = 'SERError'
  }
}

export class SERParseError extends SERError {
  constructor(message: string) {
    super(message)
    this.name = 'SERParseError'
  }
}

export class SERValidationError extends SERError {
  constructor(message: string) {
    super(message)
    this.name = 'SERValidationError'
  }
}

export class SERConversionError extends SERError {
  constructor(message: string) {
    super(message)
    this.name = 'SERConversionError'
  }
}
