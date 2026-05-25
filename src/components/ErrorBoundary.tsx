import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("LOCUS render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen bg-[#0a0a0a] text-gray-200 flex items-center justify-center p-8">
          <div className="max-w-lg w-full border border-red-500/30 bg-red-950/20 rounded-lg p-6 space-y-4">
            <h1 className="text-sm font-mono uppercase tracking-widest text-red-400">
              Interface Error
            </h1>
            <p className="text-xs text-gray-400 leading-relaxed">
              The UI could not complete this operation. Reload the page and try again. If this
              happened after adding an analysis, clear older history entries to free browser
              storage.
            </p>
            <pre className="text-[10px] font-mono text-red-300/90 bg-black/40 p-3 rounded border border-white/10 overflow-auto max-h-40">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-xs font-mono uppercase tracking-widest text-white"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
