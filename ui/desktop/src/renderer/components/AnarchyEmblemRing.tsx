import React, { memo, type CSSProperties } from "react";

const ANARCHY_EMBLEM_SRC = "./images/animus/anarchy-emblem.png";
const RING_COUNT = 8;

interface AnarchyEmblemRingProps {
  variant?: "default" | "toast";
}

export const AnarchyEmblemRing = memo<AnarchyEmblemRingProps>(({ variant = "default" }) => (
  <div
    className={`anarchyEmblemRing${variant === "toast" ? " anarchyEmblemRing--toast" : ""}`}
    style={{ "--anarchy-emblem-image": `url("${ANARCHY_EMBLEM_SRC}")` } as CSSProperties}
    aria-hidden="true"
  >
    {variant === "toast" ? <span className="anarchyEmblemRing__tilefield" /> : null}
    <span className="anarchyEmblemRing__impact" />
    {Array.from({ length: RING_COUNT }, (_, index) => (
      <img key={index} className="anarchyEmblemRing__emblem" src={ANARCHY_EMBLEM_SRC} alt="" draggable={false} />
    ))}
  </div>
));

AnarchyEmblemRing.displayName = "AnarchyEmblemRing";
