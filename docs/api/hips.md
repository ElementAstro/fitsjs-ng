# HiPS API

## Core Classes

### `HiPS`

```ts
new HiPS(source: HiPSInput)
static open(source: HiPSInput): Promise<HiPS>
getProperties(): Promise<HiPSProperties>
tileFormats(): Promise<HiPSTileFormat[]>
readTile({ order, ipix, format?, frame? }): Promise<HiPSReadTileResult>
readAllsky(format?): Promise<Uint8Array>
```

`source` can be:

- local root path (`string`)
- URL (`string | URL`)
- storage target implementing `HiPSExportTarget`

Runtime notes:

- Local root paths are Node.js-only.
- Browser/React Native should use URL sources or custom `HiPSExportTarget` objects.

### `HiPSProperties`

```ts
HiPSProperties.parse(text: string): HiPSProperties
HiPSProperties.fromObject(values): HiPSProperties
get(key): string | undefined
set(key, value): this
validate(): HiPSValidationReport
withCompatibilityFields(): this
toString(): string
```

## Conversion

### `convertFitsToHiPS(input, options)`

Creates HiPS directory outputs from FITS.

Important options:

- `output: HiPSExportTarget` (required)
- `hipsOrder`, `minOrder`, `tileWidth`
- `frame: 'equatorial' | 'galactic' | 'ecliptic'`
- `formats: ('fits' | 'png' | 'jpeg')[]`
- `interpolation: 'nearest' | 'bilinear' | 'bicubic'`

### `convertHiPSToFITS(input, options)`

Exports HiPS as:

- `tile`: one tile FITS
- `map`: HEALPix map FITS
- `cutout`: WCS cutout FITS

Remote options:

- `backend: 'local' | 'remote' | 'auto'`
- `hipsId`
- `endpoint`, `endpointFallback`, `timeoutMs`

### `convertXisfToHiPS(input, options)`

Converts one XISF image into a HiPS dataset.

Additional options on top of `convertFitsToHiPS`:

- `imageIndex?: number` (default `0`)
- `xisfReadOptions?: XISFReadOptions`

Notes:

- complex sample formats (`Complex32`, `Complex64`) are rejected for HiPS conversion.
- multi-image XISF units can be exported deterministically by selecting `imageIndex`.

### `convertHiPSToXisf(input, options)`

Converts HiPS exports into XISF.

- accepts the same `tile` / `map` / `cutout` options as `convertHiPSToFITS`
- forwards `distributed`, `writeOptions`, and `conversionOptions` to XISF output
- map-mode exports are preserved via FITS HDU metadata when no direct image plane exists

## Storage Targets

### `NodeFSTarget`

Writes to directory structure on Node.js filesystem.

Node.js-only API. In browser/React Native this throws a runtime error with migration hints.

### `BrowserZipTarget`

Collects files and creates a ZIP blob/bytes via `finalize()`.

### `BrowserOPFSTarget`

Writes HiPS tree to OPFS (Origin Private File System).

## Validation

### `lintHiPS(source)`

Checks:

- required `properties` fields
- field validity (`hips_frame`, `hips_tile_format`, etc.)
- optional file presence (`Allsky`, `Moc.fits`)
- local path naming sanity for tiles, order/format consistency checks
- cube-specific naming and metadata consistency checks

Notes:

- missing/invalid required `properties` entries are reported as `error`
- property advisories (e.g. non power-of-two tile width) are reported as `warning`
- for cube datasets, non-FITS Allsky is intentionally not generated; `properties` includes `hips_allsky_restriction`
- local filesystem path linting is Node.js-only; browser/React Native receives actionable runtime errors in the report
