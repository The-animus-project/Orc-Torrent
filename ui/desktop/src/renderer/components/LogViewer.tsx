import React, { useEffect, useRef, useState, useCallback } from "react";
import { logger } from "../utils/logger";

interface LogViewerProps {
  maxLines?: number;
}

export const LogViewer: React.FC<LogViewerProps> = ({ maxLines = 500 }) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const cleanupWatchRef = useRef<(() => void) | null>(null);

  // Auto-scroll to bottom when new logs arrive
  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current && shouldAutoScrollRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, []);

  // Load initial logs
  useEffect(() => {
    const loadInitialLogs = async () => {
      try {
        if (window.orc?.daemon?.readLogs) {
          const initialLogs = await window.orc.daemon.readLogs(maxLines);
          setLogs(initialLogs);
          setIsLoading(false);
          setTimeout(scrollToBottom, 100);
        } else {
          setIsLoading(false);
        }
      } catch (err) {
        logger.errorWithPrefix("LogViewer", "Failed to load initial logs:", err);
        setIsLoading(false);
      }
    };

    loadInitialLogs();
  }, [maxLines, scrollToBottom]);

  // Watch for new log lines
  useEffect(() => {
    if (!window.orc?.daemon?.watchLogs) return;

    const handleNewLog = (line: string) => {
      setLogs((prev) => {
        const newLogs = [...prev, line];
        // Keep only the last maxLines
        if (newLogs.length > maxLines) {
          return newLogs.slice(-maxLines);
        }
        return newLogs;
      });
      // Scroll to bottom after a short delay to allow DOM update
      setTimeout(scrollToBottom, 10);
    };

    const cleanup = window.orc.daemon.watchLogs(handleNewLog);
    cleanupWatchRef.current = cleanup;

    return () => {
      if (cleanup) cleanup();
    };
  }, [maxLines, scrollToBottom]);

  // Handle scroll events to determine if we should auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // If user scrolled up, disable auto-scroll
    shouldAutoScrollRef.current = scrollTop + clientHeight >= scrollHeight - 10;
  }, []);

  // Scroll to bottom button handler
  const handleScrollToBottom = useCallback(() => {
    shouldAutoScrollRef.current = true;
    scrollToBottom();
  }, [scrollToBottom]);

  // Color log lines based on content
  const getLogLineClass = (line: string): string => {
    const lower = line.toLowerCase();
    if (lower.includes("error") || lower.includes("panic") || lower.includes("critical")) {
      return "logLine error";
    }
    if (lower.includes("warn") || lower.includes("warning")) {
      return "logLine warn";
    }
    if (lower.includes("info") || lower.includes("startup")) {
      return "logLine info";
    }
    return "logLine";
  };

  return (
    <div className="logViewer">
      <div className="logViewerHeader">
        <div className="logViewerTitle">Daemon Logs</div>
        <button
          className="btn ghost small"
          onClick={handleScrollToBottom}
          title="Scroll to bottom"
        >
          ↓ Bottom
        </button>
      </div>
      <div
        className="logViewerContent"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        {isLoading ? (
          <div className="logViewerLoading">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="logViewerEmpty">No logs available</div>
        ) : (
          logs.map((line, idx) => (
            <div key={idx} className={getLogLineClass(line)}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
