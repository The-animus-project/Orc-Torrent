import React, { memo, useEffect, useState, useRef } from "react";
import { AnarchyEmblemRing } from "./AnarchyEmblemRing";
import { AnarchyToastIcon } from "./AnarchyToastIcon";
import { KawaiiHeartRing } from "./KawaiiHeartRing";
import {
  getNotificationThemeExitAnimationMs,
  usesAnarchyEmblemRing,
  usesKawaiiHeartRing,
  type NotificationVisualTheme,
} from "../../shared/notificationVisualThemeRegistry";
import type { Toast as ToastType } from "../types";

interface ToastProps {
  toast: ToastType | null;
  onClose: () => void;
  theme?: NotificationVisualTheme;
}

export const Toast = memo<ToastProps>(({ toast, onClose, theme = "electric" }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [remainingMs, setRemainingMs] = useState(3200);
  const [isPaused, setIsPaused] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineRef = useRef<number>(0);

  const clearTimers = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
    closeTimerRef.current = null;
    progressTimerRef.current = null;
    animationTimerRef.current = null;
  };

  const closeWithAnimation = () => {
    clearTimers();
    setIsClosing(true);
    animationTimerRef.current = setTimeout(() => {
      onClose();
    }, getNotificationThemeExitAnimationMs(theme));
  };

  useEffect(() => {
    if (!toast) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeWithAnimation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [toast]);

  const scheduleDismiss = (durationMs: number) => {
    clearTimers();
    setRemainingMs(durationMs);
    if (durationMs <= 0) {
      closeWithAnimation();
      return;
    }
    deadlineRef.current = Date.now() + durationMs;
    closeTimerRef.current = setTimeout(() => {
      closeWithAnimation();
    }, durationMs);
    progressTimerRef.current = setInterval(() => {
      setRemainingMs(Math.max(0, deadlineRef.current - Date.now()));
    }, 100);
  };

  useEffect(() => {
    clearTimers();

    if (!toast) {
      setIsClosing(false);
      setIsPaused(false);
      setRemainingMs(3200);
      return;
    }

    setIsClosing(false);
    setIsPaused(false);
    scheduleDismiss(3200);

    return () => {
      clearTimers();
    };
  }, [toast, onClose]);

  useEffect(() => {
    if (!toast || isClosing) return;
    if (isPaused) {
      clearTimers();
      setRemainingMs(Math.max(0, deadlineRef.current - Date.now()));
    } else {
      scheduleDismiss(remainingMs);
    }
  }, [isPaused]);

  if (!toast) return null;
  const title = toast.kind === "error" ? "ERROR" : "INFO";
  const icon =
    theme === "anarchy" ? null : theme === "kawaii"
      ? toast.kind === "error"
        ? "\u{1F494}"
        : "\u{1F380}"
      : toast.kind === "error"
        ? "\u26A0"
        : "\u2139";
  const progressRatio = Math.max(0, Math.min(1, remainingMs / 3200));

  return (
    <div
      className={`toast ${toast.kind} toastTheme-${theme} ${isClosing ? "closing" : ""}`}
      role="alert"
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      {usesKawaiiHeartRing(theme) ? <KawaiiHeartRing /> : null}
      {usesAnarchyEmblemRing(theme) ? <AnarchyEmblemRing variant="toast" /> : null}
      <div className="toastHeader">
        <div className="toastIcon" aria-hidden="true">
          {theme === "anarchy" ? (
            <AnarchyToastIcon phase={toast.kind === "error" ? "error" : "default"} />
          ) : (
            icon
          )}
        </div>
        <div className="toastTitle">{title}</div>
        <button type="button" className="toastDismiss" aria-label="Dismiss notification" onClick={closeWithAnimation}>
          ×
        </button>
      </div>
      <div className="toastBody">{toast.msg}</div>
      <div className="toastProgressTrack" aria-hidden="true">
        <div className="toastProgressFill" style={{ transform: `scaleX(${progressRatio})` }} />
      </div>
    </div>
  );
});

Toast.displayName = "Toast";
