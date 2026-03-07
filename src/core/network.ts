export interface NetworkReadOptions {
  requestInit?: RequestInit
  timeoutMs?: number
  retryCount?: number
  retryDelayMs?: number
}

const DEFAULT_RETRY_COUNT = 0
const DEFAULT_RETRY_DELAY_MS = 0

function normalizeNonNegativeInteger(
  value: number | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return value
}

function normalizePositiveFiniteNumber(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`)
  }
  return value
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export class NetworkTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number, cause?: unknown) {
    super(`Request timed out after ${timeoutMs}ms`)
    this.name = 'NetworkTimeoutError'
    this.timeoutMs = timeoutMs
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

export function mergeHeaders(base?: HeadersInit, override?: HeadersInit): Headers {
  const headers = new Headers(base)
  if (override) {
    const overrideHeaders = new Headers(override)
    overrideHeaders.forEach((value, key) => {
      headers.set(key, value)
    })
  }
  return headers
}

export function mergeRequestInit(base?: RequestInit, override?: RequestInit): RequestInit {
  const merged: RequestInit = {
    ...(base ?? {}),
    ...(override ?? {}),
  }

  const mergedHeaders = mergeHeaders(base?.headers, override?.headers)
  merged.headers = mergedHeaders

  if (override?.signal !== undefined) {
    merged.signal = override.signal
  } else if (base?.signal !== undefined) {
    merged.signal = base.signal
  }

  return merged
}

export function normalizeNetworkReadOptions(options?: NetworkReadOptions): {
  requestInit?: RequestInit
  timeoutMs?: number
  retryCount: number
  retryDelayMs: number
} {
  return {
    requestInit: options?.requestInit,
    timeoutMs: normalizePositiveFiniteNumber(options?.timeoutMs, 'timeoutMs'),
    retryCount: normalizeNonNegativeInteger(options?.retryCount, 'retryCount', DEFAULT_RETRY_COUNT),
    retryDelayMs: normalizeNonNegativeInteger(
      options?.retryDelayMs,
      'retryDelayMs',
      DEFAULT_RETRY_DELAY_MS,
    ),
  }
}

export async function withNetworkRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options?: {
    retryCount?: number
    retryDelayMs?: number
    signal?: AbortSignal
  },
): Promise<T> {
  const retryCount = normalizeNonNegativeInteger(
    options?.retryCount,
    'retryCount',
    DEFAULT_RETRY_COUNT,
  )
  const retryDelayMs = normalizeNonNegativeInteger(
    options?.retryDelayMs,
    'retryDelayMs',
    DEFAULT_RETRY_DELAY_MS,
  )

  let attempt = 0
  for (;;) {
    if (options?.signal?.aborted) {
      throw new Error('The operation was aborted')
    }

    try {
      return await operation(attempt)
    } catch (error) {
      if (options?.signal?.aborted) {
        throw error
      }
      if (attempt >= retryCount) {
        throw error
      }
      const delayMs = retryDelayMs * 2 ** attempt
      attempt += 1
      if (delayMs > 0) {
        await sleep(delayMs)
      }
    }
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  requestInit: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  if (timeoutMs === undefined) {
    return fetch(input, requestInit)
  }

  const controller = new AbortController()
  const externalSignal = requestInit.signal
  let timedOut = false

  const onAbort = () => {
    controller.abort(externalSignal?.reason)
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true })
    }
  }

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(input, {
      ...requestInit,
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new NetworkTimeoutError(timeoutMs, error)
    }
    throw error
  } finally {
    clearTimeout(timer)
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onAbort)
    }
  }
}

export async function fetchWithNetworkPolicy(
  input: RequestInfo | URL,
  options?: NetworkReadOptions,
  requestInit?: RequestInit,
): Promise<Response> {
  const normalized = normalizeNetworkReadOptions(options)
  const mergedRequestInit = mergeRequestInit(normalized.requestInit, requestInit)

  return withNetworkRetry(() => fetchWithTimeout(input, mergedRequestInit, normalized.timeoutMs), {
    retryCount: normalized.retryCount,
    retryDelayMs: normalized.retryDelayMs,
    signal: mergedRequestInit.signal ?? undefined,
  })
}

export async function fetchOkWithNetworkPolicy(
  input: RequestInfo | URL,
  options?: NetworkReadOptions,
  requestInit?: RequestInit,
  errorPrefix: string = 'Failed to fetch resource',
): Promise<Response> {
  const normalized = normalizeNetworkReadOptions(options)
  const mergedRequestInit = mergeRequestInit(normalized.requestInit, requestInit)

  return withNetworkRetry(
    async () => {
      const response = await fetchWithTimeout(input, mergedRequestInit, normalized.timeoutMs)
      if (!response.ok) {
        throw new Error(`${errorPrefix}: ${response.status} ${response.statusText}`)
      }
      return response
    },
    {
      retryCount: normalized.retryCount,
      retryDelayMs: normalized.retryDelayMs,
      signal: mergedRequestInit.signal ?? undefined,
    },
  )
}
