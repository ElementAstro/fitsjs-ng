# Standards Fixtures

This folder contains interoperability fixtures grouped by format and standard profile.

## FITS fixtures (Astropy-generated)

Current files under `fits/`:

- `hcompress_4x4_i16.fits`
- `plio_4x4_i16.fits`
- `gzip_4x4_i16.fits`
- `rice_4x4_i16.fits`
- `gzip_5x4_i16_tiled_3x2.fits` (multi-tile, partial edge tiles)

Re-generate these fixtures with:

```bash
py test/fixtures/standards/fits/generate-astropy-fixtures.py
```

Environment used for generation:

- Python 3.13
- `astropy` (latest at generation time)
- `numpy` (latest at generation time)

## Planned additional layout

- `fits/`
  - `tables/` (ASCII/BINTABLE edge cases)
- `xisf/`
  - `codec/` (`zlib`, `lz4`, `lz4hc`, `zstd`)
  - `layout/` (monolithic/distributed/indexed blocks)
- `hips/`
  - `image/` and `cube/` datasets
  - valid/invalid `properties` variants

The current test suite generates most fixtures in-memory for deterministic behavior. Static fixture files can be added incrementally under this structure.
