import { forwardRef, type TextareaHTMLAttributes } from "react";
import s from "./Textarea.module.css";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  maxLength?: number;
  currentLength?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, maxLength, currentLength, className, ...props }, ref) => {
    const isOver = maxLength != null && currentLength != null && currentLength > maxLength;

    const wrapperClass = [s.wrapper, error && s.error, className]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={wrapperClass}>
        {label && <label className={s.label}>{label}</label>}
        <textarea ref={ref} className={s.textarea} maxLength={maxLength} {...props} />
        <div className={s.footer}>
          <span>{error && <span className={s.errorText}>{error}</span>}</span>
          {maxLength != null && currentLength != null && (
            <span className={`${s.counter} ${isOver ? s.counterOver : ""}`}>
              {currentLength}/{maxLength}
            </span>
          )}
        </div>
      </div>
    );
  }
);

Textarea.displayName = "Textarea";