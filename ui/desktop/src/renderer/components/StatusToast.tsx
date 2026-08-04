import React, { memo, useEffect, useRef, useState } from "react";
import { AnarchyEmblemRing } from "./AnarchyEmblemRing";
import { AnarchyToastIcon } from "./AnarchyToastIcon";
import { KawaiiHeartRing } from "./KawaiiHeartRing";
import {
  getNotificationThemeExitAnimationMs,
  usesAnarchyEmblemRing,
  usesKawaiiHeartRing,
  type NotificationVisualTheme,
} from "../../shared/notificationVisualThemeRegistry";
import type { StatusToastNotification } from "../types";

interface StatusToastProps {
  toast: StatusToastNotification | null;
  onClose: () => void;
  theme?: NotificationVisualTheme;
}

const DEFAULT_DURATION_MS = 4200;
const LOADING_DURATION_MS = 7000;
const TICK_MS = 100;

export const StatusToast = memo<StatusToastProps>(({ toast, onClose, theme = "electric" }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [remainingMs, setRemainingMs] = useState(DEFAULT_DURATION_MS);
  const [isPaused, setIsPaused] = useState(false);
  const deadlineRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAllTimers = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
    intervalRef.current = null;
    closeTimerRef.current = null;
    animationTimerRef.current = null;
  };

  const closeWithAnimation = () => {
    clearAllTimers();
    setIsClosing(true);
    animationTimerRef.current = setTimeout(() => {
      onClose();
    }, getNotificationThemeExitAnimationMs(theme));
  };

  const scheduleFromRemaining = (nextRemainingMs: number) => {
    clearAllTimers();
    setRemainingMs(nextRemainingMs);
    if (nextRemainingMs <= 0) {
      closeWithAnimation();
      return;
    }
    deadlineRef.current = Date.now() + nextRemainingMs;
    closeTimerRef.current = setTimeout(() => {
      closeWithAnimation();
    }, nextRemainingMs);
    intervalRef.current = setInterval(() => {
      const left = Math.max(0, deadlineRef.current - Date.now());
      setRemainingMs(left);
    }, TICK_MS);
  };

  useEffect(() => {
    if (!toast) {
      clearAllTimers();
      setIsClosing(false);
      setIsPaused(false);
      setRemainingMs(DEFAULT_DURATION_MS);
      return;
    }
    setIsClosing(false);
    setIsPaused(false);
    const durationMs = toast.phase === "loading" ? LOADING_DURATION_MS : DEFAULT_DURATION_MS;
    scheduleFromRemaining(durationMs);
    return () => clearAllTimers();
  }, [toast]);

  useEffect(() => {
    if (!toast || isClosing) return;
    if (isPaused) {
      clearAllTimers();
      setRemainingMs(Math.max(0, deadlineRef.current - Date.now()));
      return;
    }
    scheduleFromRemaining(remainingMs);
  }, [isPaused]);

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

  if (!toast) return null;

  const progressRatio = Math.max(
    0,
    Math.min(1, remainingMs / (toast.phase === "loading" ? LOADING_DURATION_MS : DEFAULT_DURATION_MS))
  );
  const icon =
    theme === "anarchy"
      ? null
      : theme === "kawaii"
        ? toast.phase === "success"
          ? "\u{1F496}"
          : toast.phase === "error"
            ? "\u{1F494}"
            : "\u{1F495}"
        : toast.phase === "success"
          ? "\u2713"
          : toast.phase === "error"
            ? "\u26A0"
            : "\u2022";
  const title = toast.phase === "success" ? "COMPLETED" : toast.phase === "error" ? "STATUS ERROR" : "WORKING";

  return (
    <div
      className={`toast statusToast status-${toast.phase} toastTheme-${theme} ${isClosing ? "closing" : ""}`}
      role="status"
      aria-live={toast.phase === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      {usesKawaiiHeartRing(theme) ? <KawaiiHeartRing /> : null}
      {usesAnarchyEmblemRing(theme) ? <AnarchyEmblemRing variant="toast" /> : null}
      <div className="toastHeader">
        <div className={`toastIcon ${toast.phase === "loading" ? "statusDot" : ""}`} aria-hidden="true">
          {theme === "anarchy" ? (
            <AnarchyToastIcon
              phase={toast.phase === "loading" ? "loading" : toast.phase === "error" ? "error" : "success"}
            />
          ) : (
            icon
          )}
        </div>
        <div className="toastTitle">{title}</div>
        <button
          type="button"
          className="toastDismiss"
          aria-label="Dismiss status notification"
          onClick={closeWithAnimation}
        >
          ×
        </button>
      </div>
      <div className="toastBody">{toast.msg}</div>
      {toast.detail ? <div className="toastDetail">{toast.detail}</div> : null}
      <div className="toastProgressTrack" aria-hidden="true">
        <div className="toastProgressFill" style={{ transform: `scaleX(${progressRatio})` }} />
      </div>
    </div>
  );
});

StatusToast.displayName = "StatusToast";
