/**
 * Keyboard shortcut utilities for the application
 */

import React from 'react';

export type KeyboardShortcut = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  handler: (e: KeyboardEvent) => void;
  description: string;
};

/**
 * Parse a keyboard shortcut string (e.g., "Ctrl+M", "Ctrl+Shift+T")
 */
export function parseShortcut(shortcut: string): {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
} {
  const parts = shortcut.toLowerCase().split('+').map(s => s.trim());
  return {
    key: parts[parts.length - 1],
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta') || parts.includes('cmd'),
  };
}

/**
 * Check if a keyboard event matches a shortcut
 */
export function matchesShortcut(
  e: KeyboardEvent,
  shortcut: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
): boolean {
  const keyMatches = e.key.toLowerCase() === shortcut.key.toLowerCase() ||
                     e.code.toLowerCase() === `key${shortcut.key}`.toLowerCase();
  
  return (
    keyMatches &&
    (shortcut.ctrl === undefined || (e.ctrlKey || e.metaKey) === shortcut.ctrl) &&
    (shortcut.shift === undefined || e.shiftKey === shortcut.shift) &&
    (shortcut.alt === undefined || e.altKey === shortcut.alt) &&
    (shortcut.meta === undefined || e.metaKey === shortcut.meta)
  );
}

/**
 * Create a keyboard shortcut handler hook
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled: boolean = true) {
  React.useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs, textareas, or contenteditable elements
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('[contenteditable="true"]')
      ) {
        // Allow Escape to always work
        if (e.key === 'Escape') {
          // Let it bubble naturally
          return;
        }
        // Allow Ctrl/Cmd + key combinations to work in inputs
        if (!(e.ctrlKey || e.metaKey)) {
          return;
        }
      }

      for (const shortcut of shortcuts) {
        if (matchesShortcut(e, {
          key: shortcut.key,
          ctrl: shortcut.ctrl,
          shift: shortcut.shift,
          alt: shortcut.alt,
          meta: shortcut.meta,
        })) {
          e.preventDefault();
          shortcut.handler(e);
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shortcuts, enabled]);
}
