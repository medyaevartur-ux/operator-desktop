import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import s from "./Updater.module.css";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Проверка обновлений с ретраями (сеть бывает нестабильной). */
async function checkWithRetry(attempts = 3): Promise<Update | null> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await check();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

/** Ручная проверка обновлений (для кнопки в настройках). */
export async function checkForUpdatesManually(): Promise<string> {
  const update = await checkWithRetry();
  if (update) { window.dispatchEvent(new CustomEvent("desktop-update-available",{detail:update}));return "Доступна версия v" + update.version; }
  return "У вас последняя версия";
}

export function AppUpdater() {
  const [status, setStatus] = useState<"idle" | "available" | "downloading" | "ready" | "error">("idle");
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  // Сохраняем найденный объект обновления, чтобы НЕ дёргать check() повторно при установке.
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const update = await checkWithRetry();
        if (update) {
          updateRef.current = update;
          setVersion(update.version);
          setStatus((prev) => (prev === "downloading" || prev === "ready" ? prev : "available"));
        }
      } catch (e) {
        // Тихо: периодическая проверка не должна пугать оператора баннером.
        console.error("Update check failed:", e);
      }
    };

    const manual=(event:Event)=>{const update=(event as CustomEvent<Update>).detail;updateRef.current=update;setVersion(update.version);setStatus("available")};
    window.addEventListener("desktop-update-available",manual);
    const timer = setTimeout(checkUpdate, 5000);
    const interval = setInterval(checkUpdate, 30 * 60 * 1000);

    return () => {
      window.removeEventListener("desktop-update-available",manual);
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const handleUpdate = async () => {
    try {
      setStatus("downloading");
      setProgress(0);
      setErrorMsg("");

      // Переиспользуем уже найденное обновление; вторую сетевую проверку НЕ делаем.
      let update = updateRef.current;
      if (!update) update = await checkWithRetry();
      if (!update) {
        setStatus("idle");
        return;
      }

      let downloaded = 0;
      let contentLength = 0;

      // Скачивание с одним повтором при сетевом сбое.
      const doDownload = async () => {
        await update!.downloadAndInstall((event) => {
          if (event.event === "Started" && event.data.contentLength) {
            contentLength = event.data.contentLength;
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.round((downloaded / contentLength) * 100));
            }
          } else if (event.event === "Finished") {
            setStatus("ready");
          }
        });
      };

      try {
        await doDownload();
      } catch (firstErr) {
        console.error("Download failed, retrying once:", firstErr);
        downloaded = 0;
        contentLength = 0;
        setProgress(0);
        await sleep(2000);
        await doDownload();
      }

      await relaunch();
    } catch (e: any) {
      const msg = e?.message || e?.toString() || "Сетевая ошибка";
      console.error("Update failed:", e);
      setErrorMsg(msg);
      setStatus("error");
    }
  };

  if (status === "idle") return null;

  return (
    <div className={s.toast}>
      {status === "available" && (
        <>
          <div className={s.title}>🎉 Обновление v{version}</div>
          <div className={s.desc}>Доступна новая версия приложения</div>
          <div className={s.btnRow}>
            <button className={s.updateBtn} onClick={() => void handleUpdate()}>
              Обновить
            </button>
            <button className={s.laterBtn} onClick={() => setStatus("idle")}>
              Позже
            </button>
          </div>
        </>
      )}

      {status === "downloading" && (
        <>
          <div className={s.title}>⬇️ Загрузка обновления...</div>
          <div className={s.progressTrack}>
            <div className={s.progressBar} style={{ width: `${progress}%` }} />
          </div>
          <div className={s.progressText}>{progress}%</div>
        </>
      )}

      {status === "ready" && (
        <div className={s.readyText}>✅ Перезапуск...</div>
      )}

      {status === "error" && (
        <>
          <div className={s.title}>⚠️ Не удалось обновить</div>
          <div className={s.desc}>{errorMsg || "Проверьте соединение и попробуйте ещё раз."}</div>
          <div className={s.btnRow}>
            <button className={s.updateBtn} onClick={() => void handleUpdate()}>Повторить</button>
            <button className={s.laterBtn} onClick={() => setStatus("idle")}>Позже</button>
          </div>
        </>
      )}
    </div>
  );
}
