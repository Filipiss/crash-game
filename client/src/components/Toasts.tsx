import type { Toast } from "../hooks/useToasts.ts";

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    // aria-live: leitores de tela anunciam as mensagens novas
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}
