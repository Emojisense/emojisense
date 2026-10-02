import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

interface ToastItem {
  id: number;
  message: string;
  emoji?: string;
}

type Notify = (message: string, emoji?: string) => void;

const ToastContext = createContext<Notify>(() => undefined);

/** Short confirmations ("Copied", "Webhook deleted"), announced politely to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const notify = useCallback<Notify>((message, emoji) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-2), { id, message, emoji }]);
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 3200);
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className="toast">
            {item.emoji && (
              <span className="emoji" aria-hidden="true">
                {item.emoji}
              </span>
            )}
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Notify {
  return useContext(ToastContext);
}
