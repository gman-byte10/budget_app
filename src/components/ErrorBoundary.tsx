import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render/runtime errors anywhere below it so a single bad screen shows a
 * recoverable message instead of a blank app. Your data (in IndexedDB) is never
 * touched by a crash.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen grid place-items-center p-6 text-center">
          <div className="max-w-sm">
            <div className="text-5xl mb-3">🛟</div>
            <h1 className="text-lg font-bold">Something hiccuped</h1>
            <p className="text-sm text-ink-soft mt-2">
              The screen ran into an error, but your data is safe on this device. Try going back to
              the home screen.
            </p>
            <pre className="text-[11px] text-ink-faint bg-canvas rounded-lg p-2 mt-3 overflow-auto text-left">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => {
                this.setState({ error: null })
                location.assign('/')
              }}
              className="mt-4 rounded-xl bg-brand text-white px-4 py-3 font-semibold w-full"
            >
              Back to home
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
