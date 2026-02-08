import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col h-screen bg-red-950 text-white p-6 justify-center items-center overflow-auto text-left">
          <h1 className="text-3xl font-bold mb-4 text-red-500">App Crashed</h1>
          <p className="mb-4">An unexpected error occurred.</p>
          
          <div className="bg-black/50 p-4 rounded text-xs font-mono w-full max-w-lg mb-4 whitespace-pre-wrap">
            {this.state.error?.toString()}
          </div>
          
          {this.state.errorInfo && (
            <details className="w-full max-w-lg mb-4">
              <summary className="cursor-pointer text-slate-400">Component Stack</summary>
              <pre className="text-[10px] text-slate-500 mt-2 overflow-x-auto">
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}

          <button
            className="mt-4 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded"
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
          >
            Clear Data & Restart
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
