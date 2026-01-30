import React, { memo, useCallback, useState, useEffect, useRef } from "react";
import type { SortColumn } from "./TorrentTable";

interface ColumnChooserProps {
  visibleColumns: Set<SortColumn>;
  onColumnsChange: (columns: Set<SortColumn>) => void;
  savedLayouts: string[];
  onSaveLayout: (name: string) => void;
  onLoadLayout: (name: string) => void;
}

const ALL_COLUMNS: { id: SortColumn; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "progress", label: "Progress" },
  { id: "status", label: "Status" },
  { id: "size", label: "Size" },
  { id: "eta", label: "ETA" },
  { id: "seeds", label: "Seeds" },
  { id: "peers", label: "Peers" },
  { id: "downSpeed", label: "Down Speed" },
  { id: "upSpeed", label: "Up Speed" },
  { id: "ratio", label: "Ratio" },
  { id: "queue", label: "Queue" },
  { id: "added", label: "Added" },
  { id: "availability", label: "Availability" },
  { id: "health", label: "Health" },
];

export const ColumnChooser = memo<ColumnChooserProps>(({
  visibleColumns,
  onColumnsChange,
  savedLayouts,
  onSaveLayout,
  onLoadLayout,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [layoutName, setLayoutName] = useState("");
  const chooserRef = useRef<HTMLDivElement>(null);

  const handleToggleColumn = useCallback((column: SortColumn) => {
    const newColumns = new Set(visibleColumns);
    if (newColumns.has(column)) {
      if (newColumns.size > 1) {
        newColumns.delete(column);
      }
    } else {
      newColumns.add(column);
    }
    onColumnsChange(newColumns);
  }, [visibleColumns, onColumnsChange]);

  const handleSelectAll = useCallback(() => {
    onColumnsChange(new Set(ALL_COLUMNS.map(c => c.id)));
  }, [onColumnsChange]);

  const handleDeselectAll = useCallback(() => {
    onColumnsChange(new Set(["name"]));
  }, [onColumnsChange]);

  const handleSaveLayout = useCallback(() => {
    if (layoutName.trim()) {
      onSaveLayout(layoutName.trim());
      setLayoutName("");
    }
  }, [layoutName, onSaveLayout]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (isOpen && chooserRef.current && !chooserRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen]);

  if (!isOpen) {
    return (
      <button
        className="btn ghost"
        onClick={() => setIsOpen(true)}
        title="Choose Columns"
      >
        COLUMNS
      </button>
    );
  }

  return (
    <div className="columnChooser" ref={chooserRef}>
      <div className="columnChooserHeader">
        <div className="columnChooserTitle">Column Chooser</div>
        <button
          className="btn ghost"
          onClick={() => setIsOpen(false)}
        >
          ×
        </button>
      </div>
      <div className="columnChooserContent">
        <div className="columnChooserSection">
          <div className="columnChooserSectionTitle">Visible Columns</div>
          <div className="columnChooserActions">
            <button className="btn ghost small" onClick={handleSelectAll}>
              Select All
            </button>
            <button className="btn ghost small" onClick={handleDeselectAll}>
              Deselect All
            </button>
          </div>
          <div className="columnChooserList">
            {ALL_COLUMNS.map(column => (
              <label key={column.id} className="columnChooserItem">
                <input
                  type="checkbox"
                  checked={visibleColumns.has(column.id)}
                  onChange={() => handleToggleColumn(column.id)}
                  disabled={visibleColumns.size === 1 && visibleColumns.has(column.id)}
                />
                <span>{column.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="columnChooserSection">
          <div className="columnChooserSectionTitle">Saved Layouts</div>
          <div className="columnChooserLayouts">
            {savedLayouts.map(layout => (
              <button
                key={layout}
                className="btn ghost small"
                onClick={() => onLoadLayout(layout)}
              >
                {layout}
              </button>
            ))}
          </div>
          <div className="columnChooserSave">
            <input
              className="input small"
              type="text"
              placeholder="Layout name"
              value={layoutName}
              onChange={(e) => setLayoutName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveLayout()}
            />
            <button
              className="btn small"
              onClick={handleSaveLayout}
              disabled={!layoutName.trim()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

ColumnChooser.displayName = "ColumnChooser";
