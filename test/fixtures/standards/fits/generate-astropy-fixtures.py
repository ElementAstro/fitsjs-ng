from pathlib import Path

import numpy as np
from astropy.io import fits

OUT_DIR = Path(__file__).resolve().parent


def write_fixture(path: Path, data: np.ndarray, compression_type: str, tile_shape: tuple[int, int]) -> None:
    fits.HDUList(
        [
            fits.PrimaryHDU(),
            fits.CompImageHDU(data=data, compression_type=compression_type, tile_shape=tile_shape),
        ],
    ).writeto(path, overwrite=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    data_4x4 = np.array(
        [
            [-30, -10, 0, 10],
            [20, 40, 80, 120],
            [160, 200, 240, 280],
            [320, 360, 400, 440],
        ],
        dtype=np.int16,
    )

    data_5x4 = np.array(
        [
            [1, 2, 3, 4, 5],
            [6, 7, 8, 9, 10],
            [11, 12, 13, 14, 15],
            [16, 17, 18, 19, 20],
        ],
        dtype=np.int16,
    )

    write_fixture(OUT_DIR / 'hcompress_4x4_i16.fits', data_4x4, 'HCOMPRESS_1', (4, 4))
    write_fixture(OUT_DIR / 'plio_4x4_i16.fits', data_4x4, 'PLIO_1', (4, 4))
    write_fixture(OUT_DIR / 'gzip_4x4_i16.fits', data_4x4, 'GZIP_1', (4, 4))
    write_fixture(OUT_DIR / 'rice_4x4_i16.fits', data_4x4, 'RICE_1', (4, 4))
    write_fixture(OUT_DIR / 'gzip_5x4_i16_tiled_3x2.fits', data_5x4, 'GZIP_1', (2, 3))

    print(f'Generated fixtures in {OUT_DIR}')


if __name__ == '__main__':
    main()
