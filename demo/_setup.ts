// __VERSION__ is a build-time define from tsup; provide fallback for direct tsx execution.
;(globalThis as Record<string, unknown>).__VERSION__ ??= '1.0.0-dev'
