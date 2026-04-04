import React, { memo, useRef, useEffect } from "react";

export interface PieceData {
  index: number;
  completed: boolean;
  downloading: boolean;
  missing: boolean;
  availability?: number;
}

interface PieceMapProps {
  pieces: PieceData[];
  width?: number;
  height?: number;
}

export const PieceMap = memo<PieceMapProps>(({
  pieces,
  width = 800,
  height = 200,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (pieces.length === 0) {
      ctx.fillStyle = "#333";
      ctx.font = "14px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("No piece data available", width / 2, height / 2);
      return;
    }

    // Calculate optimal grid layout
    // Target: fill the available area with roughly square cells
    const totalPieces = pieces.length;
    const aspectRatio = width / (height - 30); // Reserve space for legend
    
    // Calculate columns and rows to maintain roughly square cells
    const cols = Math.max(1, Math.ceil(Math.sqrt(totalPieces * aspectRatio)));
    const rows = Math.max(1, Math.ceil(totalPieces / cols));
    
    // Calculate cell size to fit the grid
    const cellWidth = Math.floor(width / cols);
    const cellHeight = Math.floor((height - 30) / rows);
    const actualCellSize = Math.max(1, Math.min(cellWidth, cellHeight, 20)); // Cap at 20px, min 1px

    // Color scheme inspired by superseedr
    const colors = {
      completed: "#4ade80",      // Green for completed pieces
      downloading: "#fbbf24",    // Yellow for downloading pieces
      missing: "#ef4444",        // Red for missing pieces
      background: "#1a1a1a",     // Dark background
    };

    let pieceIndex = 0;
    for (let row = 0; row < rows && pieceIndex < pieces.length; row++) {
      for (let col = 0; col < cols && pieceIndex < pieces.length; col++) {
        const piece = pieces[pieceIndex];
        
        // Determine color based on piece state
        let color = colors.missing;
        if (piece.completed) {
          color = colors.completed;
        } else if (piece.downloading) {
          color = colors.downloading;
        }

        // Apply availability shading if available (darker = rarer)
        if (piece.availability !== undefined && piece.availability > 0 && !piece.completed) {
          const availability = Math.max(0, Math.min(1, piece.availability / 10)); // Normalize to 0-1
          const baseColor = piece.downloading ? colors.downloading : colors.missing;
          // Mix with darker color based on availability (lower = darker)
          const r = parseInt(baseColor.slice(1, 3), 16);
          const g = parseInt(baseColor.slice(3, 5), 16);
          const b = parseInt(baseColor.slice(5, 7), 16);
          const darken = 1 - (availability * 0.5); // Darken by up to 50%
          color = `rgb(${Math.floor(r * darken)}, ${Math.floor(g * darken)}, ${Math.floor(b * darken)})`;
        }

        // Draw piece cell
        const x = col * actualCellSize;
        const y = row * actualCellSize;

        ctx.fillStyle = color;
        ctx.fillRect(x, y, actualCellSize - 1, actualCellSize - 1);

        pieceIndex++;
      }
    }

    // Draw legend
    const legendY = height - 25;
    const legendX = 10;
    const legendItemWidth = 80;
    const legendItemHeight = 15;
    const legendSpacing = 10;

    ctx.font = "11px system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // Completed
    ctx.fillStyle = colors.completed;
    ctx.fillRect(legendX, legendY, legendItemHeight, legendItemHeight);
    ctx.fillStyle = "#fff";
    ctx.fillText("Completed", legendX + legendItemHeight + 5, legendY + legendItemHeight / 2);

    // Downloading
    ctx.fillStyle = colors.downloading;
    ctx.fillRect(legendX + legendItemWidth, legendY, legendItemHeight, legendItemHeight);
    ctx.fillStyle = "#fff";
    ctx.fillText("Downloading", legendX + legendItemWidth + legendItemHeight + 5, legendY + legendItemHeight / 2);

    // Missing
    ctx.fillStyle = colors.missing;
    ctx.fillRect(legendX + legendItemWidth * 2, legendY, legendItemHeight, legendItemHeight);
    ctx.fillStyle = "#fff";
    ctx.fillText("Missing", legendX + legendItemWidth * 2 + legendItemHeight + 5, legendY + legendItemHeight / 2);

  }, [pieces, width, height]);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          border: "1px solid #333",
          borderRadius: "4px",
          backgroundColor: "#1a1a1a",
        }}
      />
    </div>
  );
});

PieceMap.displayName = "PieceMap";
