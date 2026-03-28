import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import s from "./Button.module.css";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerGhost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      icon,
      iconRight,
      loading = false,
      fullWidth = false,
      disabled,
      children,
      className,
      ...props
    },
    ref
  ) => {
    const classes = [
      s.button,
      s[variant],
      s[size],
      fullWidth && s.fullWidth,
      loading && s.loading,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <Loader2 className={s.spinner} style={{ width: 16, height: 16 }} />
        ) : icon ? (
          icon
        ) : null}
        {children && <span>{children}</span>}
        {iconRight && !loading && iconRight}
      </button>
    );
  }
);

Button.displayName = "Button";