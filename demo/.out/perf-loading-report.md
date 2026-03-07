# Perf Loading Report

Generated: 2026-03-02T09:03:29.696Z
Command: `pnpm demo:perf:loading`

## FITS URL Range Read

| Scenario             | First frame (ms) | Repeat frame (ms) | Repeat after frame switch (ms) | ArrayBuffer peak delta | Network requests |
| -------------------- | ---------------: | ----------------: | -----------------------------: | ---------------------: | ---------------: |
| baseline-legacy      |              6.3 |               0.6 |                            1.1 |              483.48 KB |              304 |
| optimized-low-memory |              2.6 |               0.5 |                            1.1 |              565.63 KB |              304 |

## HiPS Read

| Scenario             | First tile (ms) | Repeat tile (ms) | First allsky (ms) | Repeat allsky (ms) | Network requests |
| -------------------- | --------------: | ---------------: | ----------------: | -----------------: | ---------------: |
| baseline-legacy      |             1.1 |              0.3 |               0.2 |                0.1 |                5 |
| optimized-low-memory |             0.3 |              0.0 |               0.1 |                0.0 |                3 |

## Notes

- This benchmark uses deterministic in-memory mock HTTP responses for reproducibility.
- `optimized-low-memory` enables bounded caches (`FITS imageFrameCacheMaxFrames=2`, `HiPS tileCacheMaxEntries=4`, `HiPS allskyCache=true`).
- `baseline-no-cache` disables frame/tile/allsky caches.
