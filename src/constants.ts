/** Width of a single FITS header card in bytes (characters). */
export const LINE_WIDTH = 80

/** Size of a FITS block in bytes. All FITS structures are padded to this boundary. */
export const BLOCK_LENGTH = 2880

/** Number of header card lines per FITS block. */
export const LINES_PER_BLOCK = BLOCK_LENGTH / LINE_WIDTH // 36

/** Default maximum number of header lines to parse. */
export const DEFAULT_MAX_HEADER_LINES = 600

/** FITS special integer value representing a NULL pixel in compressed images. */
export const NULL_VALUE = -2147483647

/** FITS special integer value representing a 0.0 pixel in compressed images. */
export const ZERO_VALUE = -2147483646

/** Number of random values in the dithering sequence. */
export const N_RANDOM = 10000

/** Library version. */
export const VERSION = __VERSION__
