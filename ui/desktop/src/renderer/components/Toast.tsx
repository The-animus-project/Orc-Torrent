import React, { memo, useEffect, useState, useRef } from "react";
import type { Toast as ToastType } from "../types";

interface ToastProps {
  toast: ToastType | null;
  onClose: () => void;
}

export const Toast = memo<ToastProps>(({ toast, onClose }) => {
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any existing timers
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (animationTimerRef.current) {
      clearTimeout(animationTimerRef.current);
      animationTimerRef.current = null;
    }
    
    if (!toast) {
      setIsClosing(false);
      return;
    }
    
    // Reset closing state when new toast appears
    setIsClosing(false);
    
    // Start closing animation 250ms before timeout
    closeTimerRef.current = setTimeout(() => {
      setIsClosing(true);
      // Wait for animation to complete before calling onClose
      animationTimerRef.current = setTimeout(() => {
        onClose();
      }, 250);
    }, 2950);
    
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
      if (animationTimerRef.current) {
        clearTimeout(animationTimerRef.current);
      }
    };
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div 
      className={`toast ${toast.kind} ${isClosing ? "closing" : ""}`}
      role="alert"
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div className="toastTitle">
        {toast.kind === "error" ? "ERROR" : "INFO"}
      </div>
      <div className="toastBody">{toast.msg}</div>
    </div>
  );
});

Toast.displayName = "Toast";
