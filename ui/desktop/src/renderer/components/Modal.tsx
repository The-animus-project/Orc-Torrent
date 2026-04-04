import React, { useEffect, useRef } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Store the previously focused element
      previousActiveElement.current = document.activeElement as HTMLElement;

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onClose();
        }
      };

      // Trap focus within modal
      const handleTab = (e: KeyboardEvent) => {
        if (e.key !== "Tab" || !modalRef.current) return;

        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
          }
        }
      };

      document.addEventListener("keydown", handleEscape);
      document.addEventListener("keydown", handleTab);

      // Focus first focusable element
      setTimeout(() => {
        const firstFocusable = modalRef.current?.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) as HTMLElement;
        firstFocusable?.focus();
      }, 0);

      return () => {
        document.removeEventListener("keydown", handleEscape);
        document.removeEventListener("keydown", handleTab);
        // Return focus to previous element
        previousActiveElement.current?.focus();
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="modalOverlay" 
      onClick={onClose} 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby={title ? "modal-title" : undefined}
      aria-describedby={title ? undefined : "modal-description"}
    >
      <div className="modalContent" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="modalHeader">
            <h2 className="modalTitle" id="modal-title">{title}</h2>
            <button 
              className="modalClose" 
              onClick={onClose} 
              aria-label="Close modal"
              aria-keyshortcuts="Escape"
            >
              ×
            </button>
          </div>
        )}
        <div className="modalBody" id={title ? undefined : "modal-description"}>{children}</div>
      </div>
    </div>
  );
};
