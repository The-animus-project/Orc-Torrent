import React, { memo, useCallback, useState, useEffect, useRef } from "react";

interface DropZoneProps {
  onFileDrop: (file: File) => void;
  onMagnetDrop: (magnetUrl: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Drop zone overlay for drag-and-drop torrent files and magnet links
 */
export const DropZone = memo<DropZoneProps>(({
  onFileDrop,
  onMagnetDrop,
  disabled = false,
  children,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (disabled) return;
    
    dragCounter.current++;
    
    // Check if dragging files or text (for magnet links)
    if (e.dataTransfer?.types.includes("Files") || e.dataTransfer?.types.includes("text/plain")) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    dragCounter.current--;
    
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragging(false);
    dragCounter.current = 0;
    
    if (disabled) return;

    // Check for files first
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.endsWith(".torrent")) {
          onFileDrop(file);
          return; // Only handle first valid torrent file
        }
      }
    }

    // Check for magnet link in text
    const text = e.dataTransfer?.getData("text/plain");
    if (text && text.trim().startsWith("magnet:?")) {
      onMagnetDrop(text.trim());
      return;
    }

    // Check for magnet link in URL
    const url = e.dataTransfer?.getData("text/uri-list");
    if (url && url.trim().startsWith("magnet:?")) {
      onMagnetDrop(url.trim());
      return;
    }
  }, [disabled, onFileDrop, onMagnetDrop]);

  // Set up event listeners on the document
  useEffect(() => {
    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return (
    <>
      {children}
      {isDragging && !disabled && (
        <div className="dropZoneOverlay">
          <div className="dropZoneContent">
            <div className="dropZoneIcon">📥</div>
            <div className="dropZoneTitle">Drop to Add Torrent</div>
            <div className="dropZoneSubtitle">
              Drop a .torrent file or magnet link
            </div>
          </div>
        </div>
      )}
    </>
  );
});

DropZone.displayName = "DropZone";
