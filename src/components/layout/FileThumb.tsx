import { useEffect, useState } from "react";
import { X, FileText } from "lucide-react";
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
      {file.type.startsWith("image/") ? <img src={url} alt={file.name} className={s.fileThumbImg} /> : <span className={s.fileThumbDocument} title={file.name}><FileText size={24} /><small>{file.name}</small></span>}
      <button type="button" onClick={onRemove} className={s.fileRemove} aria-label={`Убрать ${file.name}`}>
        <X style={{ width: 12, height: 12 }} />
      </button>
    </div>
  );
}