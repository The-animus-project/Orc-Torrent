import React, { memo, useCallback, useState, useEffect, useRef } from "react";
import type { Torrent } from "../../types";
import { fmtBytes } from "../../utils/format";
import { patchJson } from "../../utils/api";
import { fetchTorrentContent, invalidateTorrentCache } from "../../utils/torrentFetcher";
import { Spinner } from "../Spinner";

interface FileNode {
  id: string;
  name: string;
  path: string;
  size: number;
  priority: "skip" | "normal" | "high";
  downloaded: number;
  children?: FileNode[];
}

interface FileEntry {
  path: string[];
  size: number;
  priority: string;
  downloaded: boolean;
}

// TorrentContent is now imported from torrentFetcher
import type { TorrentContent } from "../../utils/torrentFetcher";

interface FilesTabProps {
  torrent: Torrent;
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const FilesTab = memo<FilesTabProps>(({
  torrent,
  online,
  onUpdate,
  onError,
  onSuccess,
}) => {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Transform flat file list into tree structure
  const buildFileTree = useCallback((entries: FileEntry[]): FileNode[] => {
    const tree: FileNode[] = [];
    const nodeMap = new Map<string, FileNode>();

    entries.forEach((entry, index) => {
      const fullPath = entry.path.join("/");
      const nodeId = `file-${index}`;
      
      // Map priority from API format to component format
      let priority: "skip" | "normal" | "high" = "normal";
      if (entry.priority === "skip") priority = "skip";
      else if (entry.priority === "high" || entry.priority === "download") priority = "high";

      const node: FileNode = {
        id: nodeId,
        name: entry.path[entry.path.length - 1] || fullPath || "download",
        path: fullPath || "download",
        size: entry.size,
        priority,
        downloaded: entry.downloaded ? entry.size : 0,
        children: [],
      };

      nodeMap.set(fullPath, node);

      // Build parent path and find parent
      if (entry.path.length > 1) {
        const parentPath = entry.path.slice(0, -1).join("/");
        const parent = nodeMap.get(parentPath);
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(node);
        } else {
          // Create parent directory node
          const parentParts = entry.path.slice(0, -1);
          let currentPath = "";
          let currentParent: FileNode | null = null;
          
          for (let i = 0; i < parentParts.length; i++) {
            currentPath = i === 0 ? parentParts[i] : `${currentPath}/${parentParts[i]}`;
            let dirNode = nodeMap.get(currentPath);
            
            if (!dirNode) {
              dirNode = {
                id: `dir-${currentPath}`,
                name: parentParts[i],
                path: currentPath,
                size: 0,
                priority: "normal",
                downloaded: 0,
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
          
          if (currentParent) {
            currentParent.children = currentParent.children || [];
            currentParent.children.push(node);
          }
        }
      } else {
        // Root level file
        tree.push(node);
      }
    });

    return tree;
  }, []);

  // Fetch files when torrent changes with improved error handling and caching
  useEffect(() => {
    if (!online || !torrent) {
      setFiles([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    setLoading(true);
    setError(null);

    const loadFiles = async (attempt = 0) => {
      if (cancelled) return;
      
      try {
        // Use the enhanced fetcher with caching and retry logic
        const content = await fetchTorrentContent(torrent.id, {
          retries: 2,
          retryDelay: 500,
          forceRefresh: attempt > 0, // Force refresh on retry
        });
        
        if (cancelled) return;
        
        const fileTree = buildFileTree(content.files);
        setFiles(fileTree);
        setLoading(false);
        setError(null);
      } catch (e: unknown) {
        if (cancelled) return;
        
        const message = e instanceof Error ? e.message : "Failed to load files";
        
        // Retry for network errors or if no files yet (magnet link)
        if (attempt < 3 && (
          message.includes("Connection failed") ||
          message.includes("fetch") ||
          message.includes("network")
        )) {
          const delay = 1000 * Math.pow(2, attempt); // Exponential backoff
          retryTimeout = setTimeout(() => {
            if (!cancelled) {
              loadFiles(attempt + 1);
            }
          }, delay);
          return;
        }
        
        setError(message);
        setLoading(false);
        onError(message);
      }
    };

    loadFiles();

    return () => {
      cancelled = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [torrent?.id, online, buildFileTree, onError]);

  const handleRetry = useCallback(async () => {
    if (!torrent || !online) {
      setLoading(false);
      return;
    }
    
    setError(null);
    setLoading(true);
    
    // Invalidate cache and force refresh
    invalidateTorrentCache(torrent.id);
    
    try {
      const content = await fetchTorrentContent(torrent.id, {
        forceRefresh: true,
        retries: 3,
      });
      const fileTree = buildFileTree(content.files);
      setFiles(fileTree);
      setLoading(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load files";
      setError(message);
      setLoading(false);
      onError(message);
    }
  }, [torrent, online, buildFileTree, onError]);

  const handlePriorityChange = useCallback(async (fileId: string, priority: "skip" | "normal" | "high") => {
    if (!online) return;
    
    // Find the file node to get its path
    const findFileNode = (nodes: FileNode[], targetId: string): FileNode | null => {
      for (const node of nodes) {
        if (node.id === targetId) {
          return node;
        }
        if (node.children) {
          const found = findFileNode(node.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };
    
    const fileNode = findFileNode(files, fileId);
    if (!fileNode) {
      onError("File not found");
      return;
    }
    
    // Convert path string to array (split by "/")
    const pathArray = fileNode.path.split("/").filter(p => p.length > 0);
    if (pathArray.length === 0) {
      onError("Invalid file path");
      return;
    }
    
    // Map frontend priority to API format
    const apiPriority = priority === "high" ? "download" : priority;
    
    // Optimistic update: update UI immediately
    setFiles(prevFiles => {
      const updateNode = (nodes: FileNode[]): FileNode[] => {
        return nodes.map(node => {
          if (node.id === fileId) {
            return { ...node, priority };
          }
          if (node.children) {
            return { ...node, children: updateNode(node.children) };
          }
          return node;
        });
      };
      return updateNode(prevFiles);
    });
    
    try {
      // Use correct API endpoint: /torrents/:id/file-priority with path array
      await patchJson(`/torrents/${torrent.id}/file-priority`, { 
        path: pathArray,
        priority: apiPriority 
      });
      // Invalidate cache to ensure fresh data on next fetch
      invalidateTorrentCache(torrent.id);
      onUpdate();
      onSuccess("File priority updated");
    } catch (e: unknown) {
      // Revert optimistic update on error
      invalidateTorrentCache(torrent.id);
      const message = e instanceof Error ? e.message : "Failed to update file priority";
      onError(message);
      // Trigger refetch to restore correct state
      handleRetry();
    }
  }, [torrent.id, online, files, onUpdate, onError, onSuccess, handleRetry]);

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

  const renderFileNode = useCallback((node: FileNode, level: number = 0): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const hasChildren = node.children && node.children.length > 0;
    const progress = node.size > 0 ? (node.downloaded / node.size) * 100 : 0;

    return (
      <div key={node.id} className="fileNode">
        <div
          className="fileNodeRow"
          style={{ paddingLeft: `${level * 20}px` }}
        >
          {hasChildren && (
            <button
              className="fileNodeExpand"
              onClick={() => toggleExpand(node.path)}
            >
              {isExpanded ? "▼" : "▶"}
            </button>
          )}
          <div className="fileNodeName">{node.name}</div>
          <div className="fileNodeSize">{fmtBytes(node.size)}</div>
          <div className="fileNodeProgress">
            <div className="bar small">
              <div className="fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress.toFixed(1)}%</span>
          </div>
          <select
            className="select small"
            value={node.priority}
            onChange={(e) => handlePriorityChange(node.id, e.target.value as "skip" | "normal" | "high")}
            disabled={!online}
          >
            <option value="skip">Skip</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>
        {hasChildren && isExpanded && (
          <div className="fileNodeChildren">
            {node.children!.map(child => renderFileNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  }, [expandedPaths, toggleExpand, handlePriorityChange, online]);

  return (
    <div className="inspectorTabContent">
      <div className="inspectorSection">
        <div className="inspectorSectionHeader">
          <div className="inspectorSectionTitle">Files</div>
        </div>
        <div className="fileList">
          {loading ? (
            <div className="empty loading">
              <Spinner size={48} />
              <div style={{ marginTop: "16px", marginBottom: "8px" }}>Loading files...</div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Fetching file list from daemon</div>
            </div>
          ) : error ? (
            <div className="empty" style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
              <div style={{ color: "var(--error)", textAlign: "center" }}>
                <div style={{ marginBottom: "4px", fontWeight: 600 }}>Failed to load files</div>
                <div style={{ fontSize: "12px", opacity: 0.8 }}>{error}</div>
              </div>
              {online && (
                <button className="btn small" onClick={handleRetry} aria-label="Retry loading files">
                  RETRY
                </button>
              )}
            </div>
          ) : files.length === 0 ? (
            <div className="empty">
              <div style={{ marginBottom: "8px" }}>No files available</div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" }}>
                {online ? "File list may not be loaded yet" : "Connect to daemon to view files"}
              </div>
            </div>
          ) : (
            files.map(file => renderFileNode(file))
          )}
        </div>
      </div>
    </div>
  );
});

FilesTab.displayName = "FilesTab";
