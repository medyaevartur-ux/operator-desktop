import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import s from "./Input.module.css";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  inputSize?: "sm" | "md" | "lg";
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, iconLeft, iconRight, inputSize = "md", className, id, ...props }, ref) => {
    const generated = useId();
    const inputId = id ?? generated;
    const errorId = error ? `${inputId}-error` : undefined;
    return (
      <div className={[s.wrapper, error && s.error, inputSize !== "md" && s[inputSize], className].filter(Boolean).join(" ")}>
        {label && <label className={s.label} htmlFor={inputId}>{label}</label>}
        <div className={s.inputWrapper}>
          {iconLeft && <span className={s.iconLeft}>{iconLeft}</span>}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={`${s.input} ${iconLeft ? s.hasIcon : ""} ${iconRight ? s.hasRight : ""}`}
            {...props}
          />
          {iconRight && <span className={s.iconRight}>{iconRight}</span>}
        </div>
        {error && <span id={errorId} className={s.errorText}>{error}</span>}
      </div>
    );
  }
);

Input.displayName = "Input";
