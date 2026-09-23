import { Component } from "react";

/**
 * Top-level error boundary. Any render error in a page (lazy chunk failure,
 * unexpected exception) is caught here instead of blanking the whole app —
 * the exact failure mode this project hit before.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "var(--canvas, #f5f7fa)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 12 }}>⚠️</div>
            <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "var(--ink, #1f2937)" }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: 14, color: "var(--ink-faint, #6b7280)", margin: "0 0 16px" }}>
              An unexpected error occurred. Reload the page to try again.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#0E8C82",
                color: "#fff",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
