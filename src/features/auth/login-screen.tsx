import { useState, useCallback } from "react";
import { LogIn, MessageSquare, Mail, Lock } from "lucide-react";
import { useAuthStore } from "@/store/auth.store";
import { Input, Button } from "@/components/ui";
import s from "./LoginScreen.module.css";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const login = useAuthStore((st) => st.login);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (isSubmitting) return;

      setErrorText("");
      setIsSubmitting(true);

      try {
        await login(email.trim(), password);
      } catch (err) {
        console.error("login error:", err);
        setErrorText("Неверный email или пароль. Попробуйте ещё раз.");
        setShakeKey((k) => k + 1);
        setIsSubmitting(false);
      }
    },
    [email, password, isSubmitting, login],
  );

  return (
    <div className={s.page}>
      {/* ═══ Левая панель ═══ */}
      <div className={s.left}>
        <div className={s.leftGlow1} />
        <div className={s.leftGlow2} />

        <div className={s.leftLogo}>
          <MessageSquare style={{ width: 36, height: 36 }} />
        </div>

        <h1 className={s.leftTitle}>Живая Сказка</h1>
        <p className={s.leftSub}>
          Панель оператора для управления чатами в реальном времени
        </p>

        <div className={s.leftFeatures}>
          <div className={s.featureItem}>
            <span className={s.featureDot} />
            Мгновенные уведомления
          </div>
          <div className={s.featureItem}>
            <span className={s.featureDot} />
            Командная работа
          </div>
          <div className={s.featureItem}>
            <span className={s.featureDot} />
            Статистика и аналитика
          </div>
        </div>
      </div>

      {/* ═══ Правая панель ═══ */}
      <div className={s.right}>
        <div className={s.formWrap}>
          <div className={s.stagger1}>
            <h2 className={s.formTitle}>Вход в систему</h2>
            <p className={s.formSub}>Введите учётные данные оператора</p>
          </div>

          <form className={s.form} onSubmit={handleSubmit}>
            <div className={s.stagger2}>
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@company.ru"
                iconLeft={<Mail style={{ width: 16, height: 16 }} />}
                inputSize="lg"
                required
                autoFocus
              />
            </div>

            <div className={s.stagger3}>
              <Input
                label="Пароль"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                iconLeft={<Lock style={{ width: 16, height: 16 }} />}
                inputSize="lg"
                required
              />
            </div>

            {errorText && (
              <div key={shakeKey} className={`${s.errorBox} ${s.shake}`}>
                {errorText}
              </div>
            )}

            <div className={s.stagger4}>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={isSubmitting}
                icon={<LogIn style={{ width: 18, height: 18 }} />}
              >
                {isSubmitting ? "Входим..." : "Войти"}
              </Button>
            </div>
          </form>

          <div className={`${s.footer} ${s.stagger5}`}>
            v2.0.0 • Живая Сказка
          </div>
        </div>
      </div>
    </div>
  );
}