import s from "./Toggle.module.css";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <div className={s.wrapper} onClick={() => !disabled && onChange(!checked)}>
      <div>
        {label && <div className={s.label}>{label}</div>}
        {description && <div className={s.description}>{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`${s.track} ${checked ? s.trackActive : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onChange(!checked);
        }}
      >
        <div className={`${s.thumb} ${checked ? s.thumbActive : ""}`} />
      </button>
    </div>
  );
}