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

## Storage Targets

### `NodeFSTarget`

Writes to directory structure on Node.js filesystem.

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
- local path naming sanity for tiles

Notes:

- missing/invalid required `properties` entries are reported as `error`
- for cube datasets, non-FITS Allsky is intentionally not generated; `properties` includes `hips_allsky_restriction`
