import React, { Component, ErrorInfo, ReactNode } from "react";
import { logger } from "../utils/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.errorWithPrefix("ErrorBoundary", "Caught an error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="errorBoundary">
          <h2 className="errorBoundaryTitle">
            Something went wrong
          </h2>
          <p className="errorBoundaryMessage">
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          {this.state.error?.stack && (
            <details className="errorBoundaryDetails">
              <summary className="errorBoundarySummary">Technical details</summary>
              <pre className="errorBoundaryStack">{this.state.error.stack}</pre>
            </details>
          )}
          <div className="errorBoundaryActions">
            <button
              onClick={this.handleReset}
              className="btn primary"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn"
            >
              Reload application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
