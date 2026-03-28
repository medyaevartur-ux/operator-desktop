import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import s from "./Input.module.css";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  inputSize?: "sm" | "md" | "lg";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, iconLeft, iconRight, inputSize = "md", className, ...props }, ref) => {
    const wrapperClass = [
      s.wrapper,
      error && s.error,
      inputSize !== "md" && s[inputSize],
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={wrapperClass}>
        {label && <label className={s.label}>{label}</label>}
        <div className={s.inputWrapper}>
          {iconLeft && <span className={s.iconLeft}>{iconLeft}</span>}
          <input
            ref={ref}
            className={`${s.input} ${iconLeft ? s.hasIcon : ""} ${iconRight ? s.hasRight : ""}`}
            {...props}
          />
          {iconRight && <span className={s.iconRight}>{iconRight}</span>}
        </div>
        {error && <span className={s.errorText}>{error}</span>}
      </div>
    );
  }
);

Input.displayName = "Input";