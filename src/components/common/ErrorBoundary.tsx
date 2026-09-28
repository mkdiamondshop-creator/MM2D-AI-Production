import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div id="error-boundary-fallback" className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-neutral-900 border border-red-900/60 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-7 h-7 shrink-0" />
              <div>
                <h2 className="text-base font-bold text-neutral-100">စနစ် လည်ပတ်မှု အမှားအယွင်း ဖြစ်ပေါ်ခဲ့သည် (Application Error)</h2>
                <p className="text-xs text-red-400 font-mono">React Lifecycle Protected</p>
              </div>
            </div>

            <div className="bg-neutral-950 rounded-lg p-4 border border-neutral-800 font-mono text-xs text-neutral-300 overflow-x-auto">
              <p className="font-semibold text-red-300">{this.state.error?.name}: {this.state.error?.message}</p>
              {this.state.error?.stack && (
                <pre className="mt-2 text-[11px] text-neutral-500 whitespace-pre-wrap leading-relaxed">
                  {this.state.error.stack.split('\n').slice(0, 6).join('\n')}
                </pre>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-200 transition-colors cursor-pointer"
              >
                ပြန်လည်ကြိုးစားမည် (Try Again)
              </button>
              <button
                onClick={this.handleReload}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-neutral-950 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                စာမျက်နှာ ပြန်ဖွင့်မည် (Reload Page)
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
