import { useCallback, useRef, useState } from "react";

export type ToastKind = "win" | "loss" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const TOAST_MS = 3_500;
const MAX_TOASTS = 3;

/** Notificações curtas que somem sozinhas (vitória, derrota, erro). */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++nextId.current;
    setToasts((list) => [...list.slice(-(MAX_TOASTS - 1)), { id, kind, text }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  return { toasts, push };
}
