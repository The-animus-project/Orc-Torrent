import React from "react";

interface SkeletonLoaderProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
  lines?: number;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  width = "100%",
  height = "1em",
  borderRadius = "4px",
  className = "",
  lines,
}) => {
  if (lines && lines > 1) {
    return (
      <div className={`skeleton-container ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="skeleton"
            style={{
              width: i === lines - 1 ? "60%" : width,
              height,
              borderRadius,
              marginBottom: i < lines - 1 ? "var(--space-2)" : "0",
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius }}
    />
  );
};

export const SkeletonRow: React.FC<{ columns?: number }> = ({ columns = 5 }) => {
  return (
    <tr className="skeleton-row">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="tableCell">
          <SkeletonLoader
            width={i === 0 ? "80%" : "60%"}
            height="var(--space-4)"
            borderRadius="var(--radius-sm)"
          />
        </td>
      ))}
    </tr>
  );
};
