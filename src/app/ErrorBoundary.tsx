import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Keeps a render bug in one view from blanking the whole draft desk. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('9dub view error', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="m-6 rounded-lg border border-bad/30 bg-bad/10 p-4 text-[13px]">
        <div className="font-semibold text-bad">This view hit an error.</div>
        <p className="mt-1 text-chalk-2">
          Your draft data is safe (it is saved locally). Switch views or reload. Details: <code className="font-mono text-[12px]">{this.state.error.message}</code>
        </p>
        <button type="button" className="mt-3 rounded-md border border-seam px-3 py-1.5 text-[12px] hover:bg-stand" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
