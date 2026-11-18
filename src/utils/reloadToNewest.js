// Reloads to the newest build (AboutPage's Reload button). The app's service worker skips waiting
// (vite.config.js), but installing and activating it is asynchronous: reloading at once can serve the old
// precached index.html again. So the reload waits for the new worker to activate, or for the timeout.
export async function reloadToNewest({
  serviceWorker = globalThis.navigator?.serviceWorker,
  reload = () => window.location.reload(),
  timeoutMs = 4000
} = {}) {
  try {
    const registration = await serviceWorker?.getRegistration()
    if (registration) {
      await registration.update()
      await waitForNewWorker(serviceWorker, registration, timeoutMs)
    }
  } catch {
    // No service worker or no network: a plain reload still loads whatever the server has now.
  }
  reload()
}

function waitForNewWorker(serviceWorker, registration, timeoutMs) {
  const worker = registration.installing || registration.waiting
  if (!worker || worker.state === 'activated') return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      worker.removeEventListener('statechange', onState)
      serviceWorker.removeEventListener('controllerchange', finish)
      resolve()
    }
    const onState = () => worker.state === 'activated' && finish()
    const timer = setTimeout(finish, timeoutMs)
    worker.addEventListener('statechange', onState)
    serviceWorker.addEventListener('controllerchange', finish)
  })
}
