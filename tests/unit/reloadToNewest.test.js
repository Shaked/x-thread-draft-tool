// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reloadToNewest } from '../../src/utils/reloadToNewest'

// A fake service worker: a registration with an installing worker, and the container's events.
function fakeWorker(state) {
  const worker = new EventTarget()
  worker.state = state
  return worker
}
function fakeContainer(registration) {
  return Object.assign(new EventTarget(), { getRegistration: vi.fn(async () => registration) })
}

describe('reloadToNewest', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reloads at once when there is no service worker', async () => {
    const reload = vi.fn()
    await reloadToNewest({ serviceWorker: undefined, reload })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads at once when there is no registration', async () => {
    const reload = vi.fn()
    await reloadToNewest({ serviceWorker: fakeContainer(undefined), reload })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('waits for the installing worker to activate, then reloads', async () => {
    const worker = fakeWorker('installing')
    const registration = { installing: worker, waiting: null, update: vi.fn(async () => {}) }
    const reload = vi.fn()
    const done = reloadToNewest({ serviceWorker: fakeContainer(registration), reload })
    await vi.advanceTimersByTimeAsync(10)
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()

    worker.state = 'activated'
    worker.dispatchEvent(new Event('statechange'))
    await done
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads after the timeout when the worker never activates', async () => {
    const worker = fakeWorker('installing')
    const registration = { installing: worker, waiting: null, update: vi.fn(async () => {}) }
    const reload = vi.fn()
    const done = reloadToNewest({ serviceWorker: fakeContainer(registration), reload, timeoutMs: 4000 })
    await vi.advanceTimersByTimeAsync(3999)
    expect(reload).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads at once when the update check fails', async () => {
    const registration = { installing: null, waiting: null, update: vi.fn(async () => Promise.reject(new Error('offline'))) }
    const reload = vi.fn()
    await reloadToNewest({ serviceWorker: fakeContainer(registration), reload })
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
