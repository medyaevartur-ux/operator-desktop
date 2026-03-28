import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import s from "./Updater.module.css";

export function AppUpdater() {
  const [status, setStatus] = useState<"idle" | "available" | "downloading" | "ready">("idle");
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const update = await check();
        if (update) {
          setVersion(update.version);
          setStatus("available");
        }
      } catch (e) {
        console.error("Update check failed:", e);
      }
    };

    const timer = setTimeout(checkUpdate, 5000);
    const interval = setInterval(checkUpdate, 30 * 60 * 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const handleUpdate = async () => {
    try {
      setStatus("downloading");
      const update = await check();
      if (!update) return;

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
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

      await relaunch();
    } catch (e) {
      console.error("Update failed:", e);
      setStatus("available");
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
    </div>
  );
}