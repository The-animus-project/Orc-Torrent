import React, { memo, useCallback, useState, useEffect, useMemo, useRef } from "react";
import { Modal } from "./Modal";
import { fmtBytes } from "../utils/format";
import { patchJson } from "../utils/api";
import { fetchTorrentContent } from "../utils/torrentFetcher";
import { getErrorMessage } from "../utils/errorHandling";

interface FileEntry {
  path: string[];
  size: number;
  priority: string;
  downloaded: boolean;
}

interface FileNode {
  id: string;
  name: string;
  path: string;
  size: number;
  selected: boolean;
  children?: FileNode[];
}

interface FileSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  torrentId: string | null;
  torrentName: string;
  torrentSize?: number; // Total torrent size
  onConfirm: (selectedFiles: string[][], startImmediately: boolean) => void;
  onError: (msg: string) => void;
}

export const FileSelectionDialog = memo<FileSelectionDialogProps>(({
  isOpen,
  onClose,
  torrentId,
  torrentName,
  torrentSize,
  onConfirm,
  onError,
}) => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [fileSelections, setFileSelections] = useState<Map<string, boolean>>(new Map());
  const [startImmediately, setStartImmediately] = useState(true); // Default to start immediately (like uTorrent)
  const [error, setError] = useState<string | null>(null);
  const loadFilesRef = useRef<(() => void) | null>(null);
  const isSubmittingRef = useRef(false); // Prevent double-submission
  const prevTorrentIdRef = useRef<string | null>(null); // Track torrentId changes to preserve selections
  const isLoadingRef = useRef(false); // Track if a load is in progress to prevent flicker
  // Store selections per torrent ID to persist across dialog open/close cycles
  const selectionsByTorrentRef = useRef<Map<string, Map<string, boolean>>>(new Map());
  // Store current fileSelections in ref for renderFileNode to avoid stale closures
  const fileSelectionsRef = useRef<Map<string, boolean>>(new Map());
  
  // Update ref whenever fileSelections changes
  useEffect(() => {
    fileSelectionsRef.current = fileSelections;
  }, [fileSelections]);

  useEffect(() => {
    if (files.length > 0) {
      const allPaths = new Set<string>();
      const collectPaths = (nodes: FileNode[]) => {
        nodes.forEach(node => {
          if (node.children && node.children.length > 0) {
            allPaths.add(node.path);
            collectPaths(node.children);
          }
        });
      };
      collectPaths(files);
      setExpandedPaths(allPaths);
    }
  }, [files]);

  // Build file tree from flat file list
  const buildFileTree = useCallback((entries: FileEntry[]): FileNode[] => {
    const tree: FileNode[] = [];
    const nodeMap = new Map<string, FileNode>();

    entries.forEach((entry, index) => {
      const fullPath = entry.path.join("/");
      const nodeId = `file-${index}`;
      
      const isSelected = entry.priority !== "skip";

      const node: FileNode = {
        id: nodeId,
        name: entry.path[entry.path.length - 1] || fullPath || "download",
        path: fullPath || "download",
        size: entry.size,
        selected: isSelected,
        children: [],
      };

      nodeMap.set(fullPath, node);

      // Build parent path and find parent
      if (entry.path.length > 1) {
        const parentPath = entry.path.slice(0, -1).join("/");
        let parent = nodeMap.get(parentPath);
        
        if (!parent) {
          // Create parent directory nodes
          const parentParts = entry.path.slice(0, -1);
          let currentPath = "";
          let currentParent: FileNode | undefined = undefined;
          
          for (let i = 0; i < parentParts.length; i++) {
            currentPath = i === 0 ? parentParts[i] : `${currentPath}/${parentParts[i]}`;
            let dirNode = nodeMap.get(currentPath);
            
            if (!dirNode) {
              dirNode = {
                id: `dir-${currentPath}`,
                name: parentParts[i],
                path: currentPath,
                size: 0,
                selected: true,
                children: [],
              };
              nodeMap.set(currentPath, dirNode);
              
              if (currentParent) {
                currentParent.children = currentParent.children || [];
                currentParent.children.push(dirNode);
              } else {
                tree.push(dirNode);
              }
            }
            currentParent = dirNode;
          }
          parent = currentParent;
        }
        
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(node);
        }
      } else {
        // Root level file
        tree.push(node);
      }
    });

    return tree;
  }, []);

  // Load file list when dialog opens - only reload when torrentId changes, not when isOpen toggles
  useEffect(() => {
    // Only reload if torrentId actually changed, not just when isOpen toggles
    const torrentIdChanged = prevTorrentIdRef.current !== torrentId;
    
    if (!isOpen || !torrentId) {
      // Only clear UI state when dialog closes, but preserve selections in ref
      if (!isOpen) {
        // Save current selections before clearing (use ref to get current state)
        if (prevTorrentIdRef.current && fileSelectionsRef.current.size > 0) {
          selectionsByTorrentRef.current.set(prevTorrentIdRef.current, new Map(fileSelectionsRef.current));
        }
        setFiles([]);
        setFileSelections(new Map());
        setExpandedPaths(new Set());
        prevTorrentIdRef.current = null;
      }
      setLoading(false);
      isLoadingRef.current = false;
      return;
    }
    
    // If torrentId changed, update the ref
    if (torrentIdChanged) {
      prevTorrentIdRef.current = torrentId;
    }

    // Prevent duplicate loads for the same torrentId
    if (isLoadingRef.current && !torrentIdChanged) {
      return;
    }

    let cancelled = false;
    isLoadingRef.current = true;
    setLoading(true);
    setError(null);
    
    // Restore selections for this torrent if they exist
    const savedSelections = selectionsByTorrentRef.current.get(torrentId);
    if (savedSelections && savedSelections.size > 0 && torrentIdChanged) {
      setFileSelections(new Map(savedSelections));
    }
    
    // Retry loading file list with exponential backoff (for magnets that need metadata)
    let retryCount = 0;
    const maxRetries = 8; // Increased retries for magnet links
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    
    const loadFiles = async () => {
      // Check if torrentId changed during async operation
      if (cancelled) return;
      
      try {
        // Use enhanced fetcher with automatic retry and caching
        const content = await fetchTorrentContent(torrentId, {
          retries: 3,
          retryDelay: 500,
          forceRefresh: retryCount > 0, // Force refresh on manual retries
        });
        
        if (cancelled) return;
        
        if (content.files && content.files.length > 0) {
          const fileTree = buildFileTree(content.files);
          setFiles(fileTree);
          
          // Initialize file selections - preserve existing user selections
          // Only set initial selections if fileSelections is empty (first load or torrentId changed)
          setFileSelections(prev => {
            // If we already have selections for this torrent, preserve them (user may have unchecked files)
            // Check if any of the current file paths exist in prev selections
            const hasExistingSelections = fileTree.some(node => {
              const checkNode = (n: FileNode): boolean => {
                if (prev.has(n.path)) return true;
                if (n.children) {
                  return n.children.some(checkNode);
                }
                return false;
              };
              return checkNode(node);
            });
            
            if (hasExistingSelections) {
              // Preserve existing selections - only add new files that don't exist yet
              const merged = new Map(prev);
              const addNewFiles = (nodes: FileNode[]) => {
                nodes.forEach(node => {
                  // Only add if not already in map (preserve user's unchecked state)
                  if (!merged.has(node.path)) {
                    const isSelected = node.size > 0 ? node.selected : true;
                    merged.set(node.path, isSelected);
                  }
                  if (node.children) {
                    addNewFiles(node.children);
                  }
                });
              };
              addNewFiles(fileTree);
              return merged;
            } else {
              // First load or torrentId changed - initialize from API priorities
              const selections = new Map<string, boolean>();
              const setSelections = (nodes: FileNode[]) => {
                nodes.forEach(node => {
                  // Use the selected state from buildFileTree (which respects priority from API)
                  // Directories are always selected
                  const isSelected = node.size > 0 ? node.selected : true;
                  selections.set(node.path, isSelected);
                  if (node.children) {
                    setSelections(node.children);
                  }
                });
              };
              setSelections(fileTree);
              return selections;
            }
          });
          
          setLoading(false);
          isLoadingRef.current = false;
          setError(null); // Clear any previous errors
        } else if (retryCount < maxRetries && !cancelled) {
          // No files yet (magnet link), retry after delay with exponential backoff
          retryCount++;
          const delay = 500 * Math.pow(2, retryCount - 1); // Exponential backoff: 500ms, 1s, 2s, 4s, 8s
          // File list not available yet (magnet link), retrying...
          timeoutId = setTimeout(() => {
            if (!cancelled) {
              loadFiles();
            }
          }, delay);
        } else {
          // No files after retries, show empty state
          if (!cancelled) {
            setFiles([]);
            setLoading(false);
            isLoadingRef.current = false;
            // Don't show error for magnet links - files may still be loading
            // File list not available after retries - this is normal for magnet links
          }
        }
      } catch (e: unknown) {
        if (cancelled) return;
        
        const errorMessage = getErrorMessage(e, "Failed to load file list");
        
        // Check if it's a timeout or network error (retryable)
        const isRetryable = 
          errorMessage.includes("timed out") ||
          errorMessage.includes("Connection failed") ||
          errorMessage.includes("fetch") ||
          errorMessage.includes("network") ||
          errorMessage.includes("aborted");
        
        if (isRetryable && retryCount < maxRetries) {
          // Retry on error (may be transient) with exponential backoff
          retryCount++;
          const delay = 500 * Math.pow(2, retryCount - 1);
          // File list load error, retrying...
          timeoutId = setTimeout(() => {
            if (!cancelled) {
              loadFiles();
            }
          }, delay);
        } else {
          // Max retries reached or non-retryable error
          if (!cancelled) {
            onError(errorMessage);
            setLoading(false);
            isLoadingRef.current = false;
            setError(errorMessage);
          }
        }
      }
    };
    
    // Store loadFiles in ref so retry button can access it
    loadFilesRef.current = loadFiles;
    
    loadFiles();
    
    return () => {
      cancelled = true;
      isLoadingRef.current = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      loadFilesRef.current = null;
    };
  }, [torrentId, buildFileTree, onError]); // Removed isOpen from dependencies - only reload when torrentId changes
  
  // Retry handler that uses the ref
  const handleRetryLoad = useCallback(() => {
    if (loadFilesRef.current && !isLoadingRef.current) {
      isLoadingRef.current = true;
      setLoading(true);
      setError(null);
      loadFilesRef.current();
    }
  }, []);

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleFileSelection = useCallback((path: string, selected: boolean) => {
    setFileSelections(prev => {
      const next = new Map(prev);
      next.set(path, selected);
      // Also update parent/child relationships for consistency
      // If unchecking a file, we might want to uncheck parent directories
      // If checking a file, we might want to check parent directories
      // Save to per-torrent storage
      if (torrentId) {
        selectionsByTorrentRef.current.set(torrentId, new Map(next));
      }
      return next;
    });
  }, [torrentId]);

  const toggleAll = useCallback((select: boolean) => {
    setFileSelections(prev => {
      const next = new Map(prev);
      const updateNode = (node: FileNode) => {
        if (node.size > 0) { // Only toggle files, not directories
          next.set(node.path, select);
        }
        if (node.children) {
          node.children.forEach(updateNode);
        }
      };
      files.forEach(updateNode);
      // Save to per-torrent storage
      if (torrentId) {
        selectionsByTorrentRef.current.set(torrentId, new Map(next));
      }
      return next;
    });
  }, [files, torrentId]);

  // Calculate total size of selected files
  const selectedSize = useMemo(() => {
    let total = 0;
    const calculateSize = (nodes: FileNode[]) => {
      nodes.forEach(node => {
        if (node.size > 0) { // Only count files
          const isSelected = fileSelections.get(node.path) ?? true;
          if (isSelected) {
            total += node.size;
          }
        }
        if (node.children) {
          calculateSize(node.children);
        }
      });
    };
    calculateSize(files);
    return total;
  }, [files, fileSelections]);

  const handleConfirm = useCallback(async () => {
    if (!torrentId) return;
    
    // Prevent double-click / multiple submissions
    if (loading || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setLoading(true);
    
    try {
      // Get list of selected file paths
      const selectedFiles: string[][] = [];
      const collectSelected = (nodes: FileNode[]) => {
        nodes.forEach(node => {
          if (node.size > 0) { // Only include files
            const isSelected = fileSelections.get(node.path) ?? true;
            if (isSelected) {
              selectedFiles.push(node.path.split("/").filter(s => s.length > 0));
            }
          }
          if (node.children) {
            collectSelected(node.children);
          }
        });
      };
      collectSelected(files);

      // Ensure we have files before proceeding (for .torrent files, files should be available)
      if (files.length === 0) {
        // No files available yet - this might be a magnet link still fetching metadata
        // Warn user but allow them to proceed if they want
        const proceed = window.confirm(
          "No files available yet. This might be a magnet link that is still fetching metadata.\n\n" +
          "Do you want to proceed anyway? The torrent will start downloading once metadata is available."
        );
        if (!proceed) {
          setLoading(false);
          isSubmittingRef.current = false;
          return;
        }
      }
      
      // Apply file priorities only if we have files
      if (files.length > 0) {
        // Set all files to skip first, then set selected files to download
        const allFiles: string[][] = [];
        const collectAll = (nodes: FileNode[]) => {
          nodes.forEach(node => {
            if (node.size > 0) {
              allFiles.push(node.path.split("/").filter(s => s.length > 0));
            }
            if (node.children) {
              collectAll(node.children);
            }
          });
        };
        collectAll(files);
        
        // Set all files to skip first (with error handling per file)
        // Use Promise.allSettled to continue even if some fail
        const skipPromises = allFiles.map(async (filePath) => {
          try {
            await patchJson(`/torrents/${torrentId}/file-priority`, {
              path: filePath,
              priority: "skip",
            });
            return { success: true, path: filePath };
          } catch (e) {
            // Log but don't fail - individual file priority errors shouldn't block
            // Failed to set priority to skip - non-critical, continue
            return { success: false, path: filePath, error: e };
          }
        });
        const skipResults = await Promise.allSettled(skipPromises);
        
        // Log summary of skip operations
        const skipSuccessCount = skipResults.filter(r => 
          r.status === "fulfilled" && r.value.success
        ).length;
        if (skipSuccessCount < allFiles.length) {
          // Some files failed to set to skip - non-critical
        }
        
        // Then set selected files to download
        const downloadPromises = selectedFiles.map(async (filePath) => {
          try {
            await patchJson(`/torrents/${torrentId}/file-priority`, {
              path: filePath,
              priority: "download",
            });
            return { success: true, path: filePath };
          } catch (e) {
            // Log but don't fail - individual file priority errors shouldn't block
            // Failed to set priority to download - non-critical, continue
            return { success: false, path: filePath, error: e };
          }
        });
        const downloadResults = await Promise.allSettled(downloadPromises);
        
        // Log summary of download priority operations
        const downloadSuccessCount = downloadResults.filter(r => 
          r.status === "fulfilled" && r.value.success
        ).length;
        if (downloadSuccessCount < selectedFiles.length) {
          // Some files failed to set to download - non-critical
        }
        
        // Verify at least some priorities were set successfully
        if (downloadSuccessCount === 0 && selectedFiles.length > 0) {
          throw new Error("Failed to set file priorities. Please try again.");
        }
        
        // Small delay to ensure priorities are persisted before starting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Confirm and close (will trigger start if startImmediately is true)
      // Only call if still mounted and torrentId is still valid
      if (torrentId) {
        onConfirm(selectedFiles, startImmediately);
        onClose();
      }
    } catch (e: unknown) {
      onError(getErrorMessage(e, "Failed to apply file selections"));
      // State cleanup moved to finally block to avoid duplication
    } finally {
      setLoading(false);
      isSubmittingRef.current = false;
    }
  }, [torrentId, files, fileSelections, startImmediately, onConfirm, onClose, onError]);

  const renderFileNode = useCallback((node: FileNode, level: number = 0): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const hasChildren = node.children && node.children.length > 0;
    // Get selection from ref to avoid stale closures - ref is always current
    const isSelected = (() => {
      const currentSelections = fileSelectionsRef.current;
      if (currentSelections.has(node.path)) {
        return currentSelections.get(node.path)!;
      }
      return node.size === 0 ? true : node.selected;
    })();
    const isFile = node.size > 0;

    return (
      <div key={node.id} className="fileNode">
        <div
          className="fileNodeRow"
          style={{ 
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: "8px",
            padding: "4px 8px",
            paddingLeft: `${8 + level * 16}px`,
            alignItems: "center",
            minHeight: "24px",
            cursor: isFile ? "default" : "pointer",
            borderRadius: "2px",
            transition: "background-color 0.1s"
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--bg-hover)"}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "4px", width: "20px" }}>
            {hasChildren && (
              <button
                className="fileNodeExpand"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(node.path);
                }}
                style={{ 
                  margin: 0,
                  padding: "2px 4px",
                  cursor: "pointer", 
                  background: "none", 
                  border: "none", 
                  color: "var(--text)",
                  fontSize: "10px",
                  lineHeight: 1
                }}
                aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                aria-expanded={isExpanded}
              >
                {isExpanded ? "▼" : "▶"}
              </button>
            )}
            {isFile && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleFileSelection(node.path, e.target.checked);
                }}
                style={{ 
                  margin: 0,
                  width: "16px",
                  height: "16px",
                  cursor: "pointer"
                }}
                aria-label={`Select ${node.name}`}
              />
            )}
          </div>
          <div 
            className="fileNodeName" 
            style={{ 
              fontSize: "12px",
              color: isFile ? "var(--text)" : "var(--text-muted)",
              fontWeight: isFile ? 400 : 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
            title={node.path}
          >
            {node.name}
          </div>
          <div 
            className="fileNodeSize" 
            style={{ 
              fontSize: "11px",
              textAlign: "right",
              minWidth: "80px",
              color: isFile ? "var(--text-muted)" : "var(--text-muted)",
              fontFamily: "monospace"
            }}
          >
            {isFile ? fmtBytes(node.size) : ""}
          </div>
        </div>
        {hasChildren && isExpanded && (
          <div className="fileNodeChildren">
            {node.children!.map(child => renderFileNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  }, [expandedPaths, toggleExpand, toggleFileSelection]); // Removed fileSelections from deps - using ref instead

  const allSelected = useMemo(() => {
    let hasFiles = false;
    let allSelected = true;
    const checkNode = (nodes: FileNode[]) => {
      nodes.forEach(node => {
        if (node.size > 0) {
          hasFiles = true;
          const isSelected = fileSelections.get(node.path) ?? true;
          if (!isSelected) {
            allSelected = false;
          }
        }
        if (node.children) {
          checkNode(node.children);
        }
      });
    };
    checkNode(files);
    return hasFiles && allSelected;
  }, [files, fileSelections]);

  // Calculate total torrent size (all files)
  const totalSize = useMemo(() => {
    if (torrentSize !== undefined) return torrentSize;
    let total = 0;
    const calculateSize = (nodes: FileNode[]) => {
      nodes.forEach(node => {
        total += node.size;
        if (node.children) {
          calculateSize(node.children);
        }
      });
    };
    calculateSize(files);
    return total;
  }, [files, torrentSize]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Torrent">
      <div style={{ padding: "20px", minWidth: "600px", maxWidth: "800px" }}>
        {/* Torrent Info Section (like uTorrent) */}
        <div style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ marginBottom: "8px", fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>
            {torrentName || "New Torrent"}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            {totalSize > 0 && `Total size: ${fmtBytes(totalSize)}`}
            {files.length > 0 && ` • ${files.length} file${files.length !== 1 ? 's' : ''}`}
          </div>
        </div>

        {/* File List Section */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
            <div style={{ marginBottom: "8px" }}>Loading file list...</div>
            <div style={{ fontSize: "11px" }}>Fetching torrent metadata</div>
          </div>
        ) : files.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ marginBottom: "12px", fontSize: "14px" }}>No files available yet.</div>
            <div style={{ fontSize: "12px", marginBottom: "16px", color: "var(--text-muted)" }}>
              {torrentId ? "For magnet links, files will appear after metadata is fetched from peers. This may take a few seconds." : "Please wait for the torrent to be added."}
            </div>
            {torrentId && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
                <button 
                  className="btn small" 
                  onClick={handleRetryLoad}
                  disabled={loading}
                  style={{ marginTop: "8px" }}
                >
                  {loading ? "Loading..." : "Retry Loading Files"}
                </button>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic", textAlign: "center" }}>
                  You can start the torrent now, and file selection will be available once metadata is loaded.
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <button
                  className="btn small"
                  onClick={() => toggleAll(!allSelected)}
                  style={{ marginRight: "8px" }}
                >
                  {allSelected ? "SELECT NONE" : "SELECT ALL"}
                </button>
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Selected: <span style={{ fontWeight: 600, color: "var(--text)" }}>{fmtBytes(selectedSize)}</span> of {fmtBytes(totalSize)}
              </div>
            </div>
            <div style={{ 
              border: "1px solid var(--border)", 
              borderRadius: "4px", 
              padding: "4px", 
              maxHeight: "350px", 
              overflowY: "auto",
              backgroundColor: "var(--bg-secondary)",
              fontSize: "12px"
            }}>
              {/* File List Header (like uTorrent) */}
              <div style={{ 
                display: "grid", 
                gridTemplateColumns: "auto 1fr auto", 
                gap: "8px",
                padding: "6px 8px",
                borderBottom: "1px solid var(--border)",
                fontWeight: 600,
                fontSize: "11px",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                backgroundColor: "var(--bg-tertiary)",
                position: "sticky",
                top: 0,
                zIndex: 1
              }}>
                <div style={{ width: "20px" }}></div>
                <div>File Name</div>
                <div style={{ textAlign: "right", minWidth: "80px" }}>Size</div>
              </div>
              <div style={{ padding: "4px 0" }}>
                {files.map(file => renderFileNode(file))}
              </div>
            </div>
          </>
        )}

        {/* Options Section (like uTorrent) */}
        <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={startImmediately}
              onChange={(e) => setStartImmediately(e.target.checked)}
              style={{ width: "16px", height: "16px", cursor: "pointer" }}
            />
            <span style={{ fontSize: "13px", color: "var(--text)" }}>Start torrent</span>
          </label>
        </div>
      </div>
      
      {/* Footer Buttons (like uTorrent) */}
      <div style={{ 
        padding: "16px 20px", 
        borderTop: "1px solid var(--border)", 
        backgroundColor: "var(--bg-secondary)",
        display: "flex", 
        justifyContent: "flex-end", 
        gap: "8px" 
      }}>
        <button 
          className="btn" 
          onClick={onClose}
          style={{ minWidth: "80px" }}
        >
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={handleConfirm}
          disabled={loading}
          style={{ minWidth: "100px" }}
        >
          {files.length === 0 ? "OK" : `OK (${fmtBytes(selectedSize)})`}
        </button>
      </div>
    </Modal>
  );
});

FileSelectionDialog.displayName = "FileSelectionDialog";
