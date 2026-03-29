import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Result, Button } from 'antd';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{ 
          height: '100%', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          padding: 40,
          background: '#f8fafc'
        }}>
          <Result
            status="error"
            title={<span style={{ fontWeight: 800, color: '#1e293b' }}>Oops! View Crashed</span>}
            subTitle={<div style={{ color: '#64748b', maxWidth: 400, margin: '0 auto' }}>
              Something went wrong while rendering this component. This might be due to a temporary data format mismatch.
              <code style={{ display: 'block', marginTop: 12, padding: 8, background: '#f1f5f9', borderRadius: 4, fontSize: 11, textAlign: 'left' }}>
                {this.state.error?.message}
              </code>
            </div>}
            icon={<AlertCircle size={64} color="#ef4444" />}
            extra={[
              <Button 
                type="primary" 
                key="reload" 
                icon={<RefreshCw size={14} />}
                onClick={() => window.location.reload()}
                style={{ borderRadius: 8, height: 40, fontWeight: 600 }}
              >
                Reload Dashboard
              </Button>
            ]}
          />
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
