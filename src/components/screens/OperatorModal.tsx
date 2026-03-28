import { useState, useEffect } from "react";
import {
  createOperator,
  updateOperator,
  uploadAvatar,
} from "@/features/operators/operators.api";
import { API_BASE } from "@/lib/api";
import { Modal, Select, Button, toast } from "@/components/ui";
import { Camera, Eye, EyeOff, Save } from "lucide-react";
import type { ChatOperator } from "@/types/operator";
import s from "./OperatorsScreen.module.css";

const ROLE_OPTIONS = [
  { value: "operator", label: "Оператор" },
  { value: "supervisor", label: "Супервайзер" },
  { value: "admin", label: "Админ" },
];

interface OperatorModalProps {
  operator: ChatOperator | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function OperatorModal({ operator, open, onClose, onSaved }: OperatorModalProps) {
  const isNew = !operator;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("operator");
  const [maxChats, setMaxChats] = useState(5);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => {
    if (operator) {
      setName(operator.name ?? "");
      setEmail(operator.email ?? "");
      setRole(operator.role ?? "operator");
      setMaxChats(operator.max_concurrent_chats ?? 5);
      setAvatarPreview(operator.avatar_url ? `${API_BASE}${operator.avatar_url}` : null);
    } else {
      setName("");
      setEmail("");
      setRole("operator");
      setMaxChats(5);
      setAvatarPreview(null);
    }
    setPassword("");
    setShowPassword(false);
  }, [operator, open]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !operator) return;

    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);

    try {
      const res = await uploadAvatar(operator.id, file);
      URL.revokeObjectURL(objectUrl);
      setAvatarPreview(`${API_BASE}${res.avatar_url}`);
    } catch {
      URL.revokeObjectURL(objectUrl);
      toast.error("Ошибка загрузки аватара");
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !email.trim()) return;
    setSaving(true);

    try {
      if (isNew) {
        if (!password) {
          toast.error("Введите пароль");
          setSaving(false);
          return;
        }
        await createOperator({
          email: email.trim(),
          name: name.trim(),
          password,
          role,
          max_concurrent_chats: maxChats,
        });
      } else {
        const data: Record<string, unknown> = {
          name: name.trim(),
          email: email.trim(),
          role,
          max_concurrent_chats: maxChats,
        };
        if (password) data.password = password;
        await updateOperator(operator.id, data);
      }
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка сохранения";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? "Новый оператор" : "Редактировать"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
            <Save style={{ width: 14, height: 14 }} />
            {saving ? "Сохранение..." : "Сохранить"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Avatar */}
        {!isNew && (
          <div className={s.avatarUpload}>
            <label
              className={s.avatarPreview}
              style={avatarPreview ? { backgroundImage: `url(${avatarPreview})` } : undefined}
            >
              {!avatarPreview && (name?.charAt(0).toUpperCase() ?? "?")}
              <div className={s.avatarCameraBadge}>
                <Camera style={{ width: 12, height: 12 }} />
              </div>
              <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: "none" }} />
            </label>
            <div className={s.avatarHint}>
              Нажмите чтобы загрузить фото<br />
              JPG, PNG, WebP до 5 МБ
            </div>
          </div>
        )}

        <div>
          <div className={s.fieldLabel}>Имя</div>
          <input className={s.fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <div className={s.fieldLabel}>Email</div>
          <input className={s.fieldInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className={s.fieldLabel}>Роль</div>
            <Select value={role} onChange={setRole} options={ROLE_OPTIONS} />
          </div>
          <div style={{ flex: 1 }}>
            <div className={s.fieldLabel}>Макс. чатов</div>
            <input
              className={s.fieldInput}
              type="number"
              min={1}
              max={50}
              value={maxChats}
              onChange={(e) => setMaxChats(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <div className={s.fieldLabel}>
            {isNew ? "Пароль" : "Новый пароль (необязательно)"}
          </div>
          <div className={s.passwordWrap}>
            <input
              className={s.fieldInput}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isNew ? "Обязательно" : "Оставьте пустым если не меняете"}
              style={{ paddingRight: 40 }}
            />
            <button
              type="button"
              className={s.passwordToggle}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword
                ? <EyeOff style={{ width: 16, height: 16 }} />
                : <Eye style={{ width: 16, height: 16 }} />}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}