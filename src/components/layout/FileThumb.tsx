import { useEffect, useState } from "react";
import { X } from "lucide-react";
import s from "./ChatComposer.module.css";

interface FileThumbProps {
  file: File;
  onRemove: () => void;
}

export function FileThumb({ file, onRemove }: FileThumbProps) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url) return null;

  return (
    <div className={s.fileThumb}>
      <img src={url} alt={file.name} className={s.fileThumbImg} />
      <button type="button" onClick={onRemove} className={s.fileRemove}>
        <X style={{ width: 12, height: 12 }} />
      </button>
    </div>
  );
}