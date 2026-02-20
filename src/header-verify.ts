import type { CardValue, ExtensionType, WarningCallback } from './types'
import { HeaderError } from './errors'

/**
 * Context interface for verification functions — represents the header state
 * during parsing so verification functions can access current parse state.
 */
export interface VerifyContext {
  cardIndex: number
  primary: boolean
  extension: boolean
  extensionType?: ExtensionType
  warn: WarningCallback
  get(key: string): CardValue
  isPrimary(): boolean
  isExtension(): boolean
}

function verifyOrder(ctx: VerifyContext, keyword: string, order: number): void {
  if (order !== ctx.cardIndex) {
    ctx.warn(`${keyword} should appear at index ${order} in the FITS header`)
  }
}

function verifyBetween(keyword: string, value: number, lower: number, upper: number): void {
  if (value < lower || value > upper) {
    throw new HeaderError(`The ${keyword} value of ${value} is not between ${lower} and ${upper}`)
  }
}

function verifyBoolean(value: CardValue): boolean {
  return value === 'T' ? true : false
}

/**
 * Verification functions for reserved FITS header keywords.
 * Each function receives (ctx, value, isArray, index?) and returns the validated value.
 */
export const VerifyFns: Record<
  string,
  (ctx: VerifyContext, value: CardValue, isArray: boolean, index?: string) => CardValue
> = {
  SIMPLE(ctx, value) {
    ctx.primary = true
    verifyOrder(ctx, 'SIMPLE', 0)
    return verifyBoolean(value)
  },

  XTENSION(ctx, value) {
    ctx.extension = true
    ctx.extensionType = value as ExtensionType
    verifyOrder(ctx, 'XTENSION', 0)
    return ctx.extensionType
  },

  BITPIX(ctx, value) {
    const v = parseInt(String(value), 10)
    verifyOrder(ctx, 'BITPIX', 1)
    if (![8, 16, 32, 64, -32, -64].includes(v)) {
      throw new HeaderError(`BITPIX value ${v} is not permitted`)
    }
    return v
  },

  NAXIS(ctx, value, isArray) {
    const v = parseInt(String(value), 10)
    if (!isArray) {
      verifyOrder(ctx, 'NAXIS', 2)
      verifyBetween('NAXIS', v, 0, 999)
      if (ctx.isExtension()) {
        if (ctx.extensionType === 'TABLE' || ctx.extensionType === 'BINTABLE') {
          if (v !== 2) {
            throw new HeaderError(`NAXIS must be 2 for TABLE and BINTABLE extensions`)
          }
        }
      }
    }
    return v
  },

  PCOUNT(ctx, value) {
    const v = parseInt(String(value), 10)
    const naxis = ctx.get('NAXIS') as number
    const order = 1 + 1 + 1 + naxis
    verifyOrder(ctx, 'PCOUNT', order)
    if (ctx.isExtension()) {
      if (ctx.extensionType === 'IMAGE' || ctx.extensionType === 'TABLE') {
        if (v !== 0) {
          throw new HeaderError(`PCOUNT must be 0 for the ${ctx.extensionType} extensions`)
        }
      }
    }
    return v
  },

  GCOUNT(ctx, value) {
    const v = parseInt(String(value), 10)
    const naxis = ctx.get('NAXIS') as number
    const order = 1 + 1 + 1 + naxis + 1
    verifyOrder(ctx, 'GCOUNT', order)
    if (ctx.isExtension()) {
      if (
        ctx.extensionType === 'IMAGE' ||
        ctx.extensionType === 'TABLE' ||
        ctx.extensionType === 'BINTABLE'
      ) {
        if (v !== 1) {
          throw new HeaderError(`GCOUNT must be 1 for the ${ctx.extensionType} extensions`)
        }
      }
    }
    return v
  },

  EXTEND(ctx, value) {
    if (!ctx.isPrimary()) {
      throw new HeaderError('EXTEND must only appear in the primary header')
    }
    return verifyBoolean(value)
  },

  BSCALE(_ctx, value) {
    return parseFloat(String(value))
  },

  BZERO(_ctx, value) {
    return parseFloat(String(value))
  },

  BLANK(ctx, value) {
    const bitpix = ctx.get('BITPIX') as number
    if (bitpix <= 0) {
      ctx.warn(`BLANK is not to be used for BITPIX = ${bitpix}`)
    }
    return parseInt(String(value), 10)
  },

  DATAMIN(_ctx, value) {
    return parseFloat(String(value))
  },

  DATAMAX(_ctx, value) {
    return parseFloat(String(value))
  },

  EXTVER(_ctx, value) {
    return parseInt(String(value), 10)
  },

  EXTLEVEL(_ctx, value) {
    return parseInt(String(value), 10)
  },

  TFIELDS(_ctx, value) {
    const v = parseInt(String(value), 10)
    verifyBetween('TFIELDS', v, 0, 999)
    return v
  },

  TBCOL(ctx, value, _isArray, index) {
    const tfields = ctx.get('TFIELDS') as number
    if (index !== undefined) {
      verifyBetween('TBCOL', parseInt(index, 10), 0, tfields)
    }
    return value
  },

  ZIMAGE(_ctx, value) {
    return verifyBoolean(value)
  },

  ZCMPTYPE(_ctx, value) {
    const v = String(value)
    if (!['GZIP_1', 'RICE_1', 'PLIO_1', 'HCOMPRESS_1'].includes(v)) {
      throw new HeaderError(`ZCMPTYPE value ${v} is not permitted`)
    }
    return v
  },

  ZBITPIX(_ctx, value) {
    const v = parseInt(String(value), 10)
    if (![8, 16, 32, 64, -32, -64].includes(v)) {
      throw new HeaderError(`ZBITPIX value ${v} is not permitted`)
    }
    return v
  },

  ZNAXIS(_ctx, value, isArray) {
    const v = parseInt(String(value), 10)
    if (!isArray) {
      verifyBetween('ZNAXIS', v, 0, 999)
    }
    return v
  },

  ZTILE(_ctx, value) {
    return parseInt(String(value), 10)
  },

  ZSIMPLE(_ctx, value) {
    return value === 'T' ? true : false
  },

  ZPCOUNT(_ctx, value) {
    return parseInt(String(value), 10)
  },

  ZGCOUNT(_ctx, value) {
    return parseInt(String(value), 10)
  },

  ZDITHER0(_ctx, value) {
    return parseInt(String(value), 10)
  },
}
