import React, { memo, useEffect, useRef, useState } from "react";
import { AnarchyEmblemRing } from "./AnarchyEmblemRing";
import { KawaiiHeartRing } from "./KawaiiHeartRing";
import {
  usesAnarchyEmblemRing,
  usesKawaiiHeartRing,
  type NotificationVisualTheme,
} from "../../shared/notificationVisualThemeRegistry";
import type { ActionToastNotification } from "../types";

interface ActionToastProps {
  toast: ActionToastNotification | null;
  onClose: () => void;
  theme?: NotificationVisualTheme;
}

const EXIT_ANIMATION_MS = 250;
const DISPLAY_DURATION_MS = 6000;
const TICK_MS = 100;

export const ActionToast = memo<ActionToastProps>(({ toast, onClose, theme = "electric" }) => {
  const [isClosing, setIsClosing] = useState(false);
  const [remainingMs, setRemainingMs] = useState(DISPLAY_DURATION_MS);
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
    }, EXIT_ANIMATION_MS);
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
      setRemainingMs(DISPLAY_DURATION_MS);
      setIsPaused(false);
      return;
    }
    setIsClosing(false);
    setIsPaused(false);
    scheduleFromRemaining(DISPLAY_DURATION_MS);
    return () => clearAllTimers();
  }, [toast]);

  useEffect(() => {
    if (!toast || isClosing) return;
    if (isPaused) {
      clearAllTimers();
      const left = Math.max(0, deadlineRef.current - Date.now());
      setRemainingMs(left);
    } else {
      scheduleFromRemaining(remainingMs);
    }
  }, [isPaused]);

  if (!toast) return null;

  const progressRatio = Math.max(0, Math.min(1, remainingMs / DISPLAY_DURATION_MS));
  const title = toast.kind === "error" ? "ACTION REQUIRED" : "QUICK ACTION";
  const icon =
    theme === "anarchy" ? null : theme === "kawaii"
      ? toast.kind === "error"
        ? "\u{1F494}"
        : "\u{1F380}"
      : toast.kind === "error"
        ? "\u26A0"
        : "\u26A1";

  return (
    <div
      className={`toast actionToast ${toast.kind} toastTheme-${theme} ${isClosing ? "closing" : ""}`}
      role="status"
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      {usesKawaiiHeartRing(theme) ? <KawaiiHeartRing /> : null}
      {usesAnarchyEmblemRing(theme) ? <AnarchyEmblemRing /> : null}
      <div className="toastHeader">
        <div className="toastIcon" aria-hidden="true">
          {theme === "anarchy" ? (
            <img className="anarchyToastIcon" src="./images/animus/anarchy-emblem.png" alt="" draggable={false} />
          ) : (
            icon
          )}
        </div>
        <div className="toastTitle">{title}</div>
        <button type="button" className="toastDismiss" aria-label="Dismiss notification" onClick={closeWithAnimation}>
          x
        </button>
      </div>
      <div className="toastBody">{toast.msg}</div>
      <div className="actionToastFooter">
        <button
          type="button"
          className="btn small"
          onClick={() => {
            void toast.onAction();
            closeWithAnimation();
          }}
        >
          {toast.actionLabel}
        </button>
      </div>
      <div className="toastProgressTrack" aria-hidden="true">
        <div className="toastProgressFill" style={{ transform: `scaleX(${progressRatio})` }} />
      </div>
    </div>
  );
});

ActionToast.displayName = "ActionToast";
