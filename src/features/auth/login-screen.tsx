import { useCallback, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";
import { Button, Input } from "@/components/ui";
import s from "./LoginScreen.module.css";

function explain(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Неверный email или пароль. Если доступ отключили, обратитесь к руководителю.";
    if (error.status === 429) return "Слишком много попыток входа. Подождите минуту и попробуйте снова.";
    if (error.status >= 500) return "Сервер временно недоступен. Попробуйте через пару минут.";
    return error.message || "Не удалось войти. Попробуйте ещё раз.";
  }
  // Понятные сообщения из сеанса (версия сервера, хранилище) показываем как есть.
  if (error instanceof Error && /[а-яё]/i.test(error.message)) return error.message;
  return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";
}

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const login = useAuthStore((st) => st.login);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setErrorText("");
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (error) {
      setErrorText(explain(error));
      setIsSubmitting(false);
    }
  }, [email, password, isSubmitting, login]);

  return (
    <main className={s.page}>
      <div className={s.column}>
        <img src="/book-mark.svg" alt="" className={s.mark} width={40} height={40} />
        <h1 className={s.title}>Живая Сказка</h1>
        <p className={s.subtitle}>Вход для команды поддержки</p>

        <form className={s.form} onSubmit={handleSubmit} noValidate={false}>
          <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="name@zhivaya-skazka.ru" inputSize="lg" required autoFocus />
          <Input label="Пароль" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            inputSize="lg" required />
          {errorText && <div role="alert" className={s.error}>{errorText}</div>}
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>{isSubmitting ? "Входим…" : "Войти"}</Button>
        </form>

        <p className={s.footer}>Версия {__APP_VERSION__}</p>
      </div>
    </main>
  );
}
