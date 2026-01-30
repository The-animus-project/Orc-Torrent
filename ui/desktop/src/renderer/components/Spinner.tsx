import React from "react";

interface SpinnerProps {
  /** Size in pixels (default: 64) */
  size?: number;
  /** Additional CSS class names */
  className?: string;
  /** Alt text for accessibility */
  alt?: string;
}

/**
 * Animated orca spinner for loading states.
 * Uses the orca yin-yang GIF animation.
 */
export const Spinner: React.FC<SpinnerProps> = ({ 
  size = 64, 
  className = "",
  alt = "Loading..."
}) => (
  <img 
    src={new URL("../../../assets/images/spinner.gif", import.meta.url).href}
    alt={alt}
    width={size} 
    height={size}
    className={`spinner ${className}`}
    style={{ 
      display: "block",
      objectFit: "contain"
    }}
  />
);

/**
 * Inline spinner for use in buttons and small spaces.
 */
export const SpinnerInline: React.FC<Omit<SpinnerProps, "size">> = (props) => (
  <Spinner size={20} {...props} />
);
