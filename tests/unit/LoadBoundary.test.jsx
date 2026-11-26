import { afterEach, describe, expect, it, vi } from 'vitest'
import { Component, lazy, Suspense } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoadBoundary from '../../src/ui/LoadBoundary.jsx'

// A file that failed to load after a deploy (#551): the import rejects, as it does when the host answers index.html.
const Missing = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))

describe('LoadBoundary (#551)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows the fallback when a lazy file fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <LoadBoundary fallback={<p>Plain theme choice</p>}>
        <Suspense fallback={<p>Loading</p>}>
          <Missing />
        </Suspense>
      </LoadBoundary>
    )
    expect(await screen.findByText('Plain theme choice')).toBeInTheDocument()
  })

  it('shows a Reload notice without a fallback, and Reload reloads the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload })
    render(
      <LoadBoundary>
        <Suspense fallback={<p>Loading</p>}>
          <Missing />
        </Suspense>
      </LoadBoundary>
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('This part of the app could not load. A new version may be out: reload to get it.')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  // Vite loads a lazy part's stylesheet before its script; after a deploy that stylesheet is gone too.
  it('shows the fallback when the stylesheet of a lazy part fails to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const NoStyles = lazy(() => Promise.reject(new Error('Unable to preload CSS for /assets/AdminLayout-Cqv4zxca.css')))
    render(
      <LoadBoundary fallback={<p>Plain theme choice</p>}>
        <Suspense fallback={<p>Loading</p>}>
          <NoStyles />
        </Suspense>
      </LoadBoundary>
    )
    expect(await screen.findByText('Plain theme choice')).toBeInTheDocument()
  })

  // A bug is not a failed load: a reload cannot fix it, so the boundary passes it on as if it were not there.
  it('passes any other render error on, without the fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    class Outer extends Component {
      state = { caught: '' }
      static getDerivedStateFromError(error) {
        return { caught: error.message }
      }
      render() {
        return this.state.caught ? <p>Outer caught: {this.state.caught}</p> : this.props.children
      }
    }
    const Broken = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'p95')")
    }
    render(
      <Outer>
        <LoadBoundary fallback={<p>Fallback</p>}>
          <Broken />
        </LoadBoundary>
      </Outer>
    )
    expect(await screen.findByText("Outer caught: Cannot read properties of undefined (reading 'p95')")).toBeInTheDocument()
    expect(screen.queryByText('Fallback')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders its children when they load', async () => {
    const Loaded = lazy(() => Promise.resolve({ default: () => <p>Loaded part</p> }))
    render(
      <LoadBoundary fallback={<p>Fallback</p>}>
        <Suspense fallback={<p>Loading</p>}>
          <Loaded />
        </Suspense>
      </LoadBoundary>
    )
    expect(await screen.findByText('Loaded part')).toBeInTheDocument()
    expect(screen.queryByText('Fallback')).toBeNull()
  })
})
