"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/model";
export function LocalOcrChoice({
  base,
  value,
  onChange,
  disabled,
}: {
  base: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setAvailable(false);
    onChange(false);
    api(`${base}/documents/capabilities`)
      .then((result) => {
        if (!cancelled) setAvailable(result.localOcrEnabled === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [base, onChange]);
  if (!available)
    return (
      <p className="muted">
        For scanned PDFs, paste the text or ask the server operator to enable
        local OCR.
      </p>
    );
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      Use local OCR for scanned PDFs (English, up to 5 pages). The document
      stays on this server. Review every amount and name against the original
      before proposing rules.
    </label>
  );
}
