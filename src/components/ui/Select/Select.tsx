import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, Check } from "lucide-react";
import s from "./Select.module.css";

interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  className?: string;
}

export function Select({ value, onChange, options, placeholder, label, className }: SelectProps) {
  return (
    <div className={`${s.wrapper} ${className ?? ""}`}>
      {label && <span className={s.label}>{label}</span>}
      <SelectPrimitive.Root value={value} onValueChange={onChange}>
        <SelectPrimitive.Trigger className={s.trigger}>
          <SelectPrimitive.Value placeholder={placeholder ?? "Выберите..."} />
          <SelectPrimitive.Icon className={s.icon}>
            <ChevronDown style={{ width: 16, height: 16 }} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className={s.content} position="popper" sideOffset={4}>
            <SelectPrimitive.Viewport className={s.viewport}>
              {options.map((opt) => (
                <SelectPrimitive.Item key={opt.value} value={opt.value} className={s.item}>
                  {opt.icon && opt.icon}
                  <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Check className={s.checkIcon} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  );
}