import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { logError } from '@/utils/logger';

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logError('React component error boundary caught an error', {
      source: 'ErrorBoundary',
      meta: { errorMessage: error.message, componentStack: info.componentStack },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-navy-900 flex items-center justify-center p-6 text-center">
          <div className="max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mx-auto mb-5">
              <AlertTriangle size={28} className="text-red-400" />
            </div>
            <h1 className="font-inter font-black text-xl text-white mb-2">কিছু একটা ভুল হয়েছে</h1>
            <p className="text-slate-400 text-sm mb-5">An unexpected error occurred.</p>
            {/*
              The raw message is a development aid only. In production it can
              carry table names, RPC parameters, or fragments of a failed query
              back to whoever triggered the crash, so it is compiled out — the
              full detail still reaches `logError` in componentDidCatch.
            */}
            {import.meta.env.DEV && this.state.error && (
              <pre className="text-xs text-red-400 bg-red-400/10 rounded-lg p-3 mb-5 text-left overflow-x-auto">
                {this.state.error.message}
              </pre>
            )}
            <button onClick={() => window.location.reload()} className="btn-primary mx-auto">
              <RefreshCw size={15} /> পেজ রিলোড করুন
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
