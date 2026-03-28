import s from "./Skeleton.module.css";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  circle?: boolean;
  text?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ width, height = 16, circle, text, className, style }: SkeletonProps) {
  const classes = [
    s.skeleton,
    circle && s.circle,
    text && s.text,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const combinedStyle: React.CSSProperties = {
    width: circle ? height : width ?? "100%",
    height,
    ...style,
  };

  return <div className={classes} style={combinedStyle} />;
}

/* Pre-built skeleton patterns */
export function SkeletonCard() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
      <Skeleton circle height={44} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton text height={14} width="60%" />
        <Skeleton text height={12} width="90%" />
        <Skeleton text height={10} width="40%" />
      </div>
    </div>
  );
}

export function SkeletonMessage({ align = "left" }: { align?: "left" | "right" }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "right" ? "flex-end" : "flex-start",
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Skeleton circle height={28} />
        <Skeleton text height={12} width={60} />
      </div>
      <Skeleton height={48} width="55%" style={{ borderRadius: "var(--radius-lg)" }} />
    </div>
  );
}