"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/** A short line at the bottom of the screen that leaves by itself (the prototype's toast). */

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const [shown, setShown] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const toast = useCallback((text: string) => {
    setMessage(text);
    setShown(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(false), 2600);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={shown ? "toast show" : "toast"} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
