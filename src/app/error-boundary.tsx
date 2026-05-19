import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "48px 24px",
            gap: 16,
            minHeight: "100%",
            textAlign: "center",
            background: "var(--surface-bg)",
            color: "var(--text-primary)",
          }}
          role="alert"
        >
          <div
            style={{
              width: 56, height: 56, borderRadius: "50%",
              background: "var(--accent-soft)",
              display: "grid", placeItems: "center",
              fontSize: 28,
            }}
          >
            ✦
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Что-то пошло не так</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 480 }}>
            {this.state.error.message || "Внутренняя ошибка интерфейса."}
            <br />
            Попробуйте обновить раздел или перезапустить приложение.
          </div>
          <button
            type="button"
            onClick={this.reset}
            style={{
              padding: "8px 18px",
              borderRadius: 10,
              border: "none",
              background: "var(--accent)",
              color: "white",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Перезагрузить раздел
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
