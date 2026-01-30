// Utilities for piece map visualization

export interface PieceData {
  index: number;
  completed: boolean;
  downloading: boolean;
  missing: boolean;
  availability?: number; // Number of peers that have this piece (optional)
}

export function calculatePieceStates(
  totalPieces: number,
  completedPieces: number,
  downloadingPieces: Set<number> = new Set()
): PieceData[] {
  const pieces: PieceData[] = [];
  
  for (let i = 0; i < totalPieces; i++) {
    const completed = i < completedPieces;
    const downloading = downloadingPieces.has(i);
    
    pieces.push({
      index: i,
      completed,
      downloading,
      missing: !completed && !downloading,
    });
  }
  
  return pieces;
}

export function estimatePiecesFromProgress(progress: number, estimatedTotalPieces: number = 100): PieceData[] {
  // Progress is already 0-1 (not 0-100), so multiply directly
  const completedPieces = Math.floor(progress * estimatedTotalPieces);
  return calculatePieceStates(estimatedTotalPieces, completedPieces);
}
