# Standards Support Matrix

This matrix tracks conformance and interoperability targets for FITS, XISF, and HiPS in `fitsjs-ng`.

## FITS

| Capability                            | Status | Notes                                                         |
| ------------------------------------- | ------ | ------------------------------------------------------------- |
| FITS 4.0 image read/write core        | ✅     | BITPIX 8/16/32/64/-32/-64, BSCALE/BZERO handling              |
| Multiple HDU parsing                  | ✅     | Primary + extension HDUs                                      |
| Binary/ASCII table support            | ✅     | Standard TFORM/TBCOL handling                                 |
| Tiled image compression `RICE_1`      | ✅     | Full decode path                                              |
| Tiled image compression `GZIP_1`      | ✅     | Decode support in `CompressedImage`                           |
| Tiled image compression `PLIO_1`      | ⚠️     | Header accepted; decode path emits explicit unsupported error |
| Tiled image compression `HCOMPRESS_1` | ⚠️     | Header accepted; decode path emits explicit unsupported error |

## XISF 1.0

| Capability                       | Status | Notes                                                            |
| -------------------------------- | ------ | ---------------------------------------------------------------- |
| Monolithic and distributed units | ✅     | `.xisf` and `.xish` + `.xisb`                                    |
| Property/Table/Image parsing     | ✅     | Core elements + references                                       |
| Signature/checksum validation    | ✅     | XML-DSig + digest checks                                         |
| Codec `zlib` / `zlib+sh`         | ✅     | Read + write                                                     |
| Codec `lz4` / `lz4+sh`           | ✅     | Read + write (default provider)                                  |
| Codec `lz4hc` / `lz4hc+sh`       | ✅     | Read + write (mapped to LZ4-compatible path)                     |
| Codec `zstd` / `zstd+sh`         | ⚠️     | Read support in default provider; write requires custom provider |

## HiPS 1.0 (image + cube)

| Capability                          | Status | Notes                                                |
| ----------------------------------- | ------ | ---------------------------------------------------- |
| HiPS `properties` read/write        | ✅     | Validation with required/invalid/warning channels    |
| Tile naming + Allsky parsing        | ✅     | Image and cube naming conventions                    |
| FITS -> HiPS generation             | ✅     | Multi-order tiles, optional MOC/Allsky/index         |
| HiPS -> FITS tile/map/cutout export | ✅     | Local + remote fallback behavior                     |
| HiPS lint checks                    | ✅     | Property, structure, order/format consistency checks |

## Cross-format conversion (six directions)

| Conversion   | Status | API                 |
| ------------ | ------ | ------------------- |
| FITS -> XISF | ✅     | `convertFitsToXisf` |
| XISF -> FITS | ✅     | `convertXisfToFits` |
| FITS -> HiPS | ✅     | `convertFitsToHiPS` |
| HiPS -> FITS | ✅     | `convertHiPSToFITS` |
| XISF -> HiPS | ✅     | `convertXisfToHiPS` |
| HiPS -> XISF | ✅     | `convertHiPSToXisf` |

## Test and fixture structure

- Standards fixtures live under `test/fixtures/standards/`
- Conversion round-trips are covered by:
  - `test/convert.test.ts`
  - `test/hips-convert.test.ts`
  - `test/hips-xisf-convert.test.ts`
  - `test/xisf-codec.test.ts`
