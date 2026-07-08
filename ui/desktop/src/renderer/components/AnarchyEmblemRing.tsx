import React, { memo } from "react";

const ANARCHY_EMBLEM_SRC = "./images/animus/anarchy-emblem.png";
const RING_COUNT = 6;

export const AnarchyEmblemRing = memo(() => (
  <div className="anarchyEmblemRing" aria-hidden="true">
    {Array.from({ length: RING_COUNT }, (_, index) => (
      <img
        key={index}
        className="anarchyEmblemRing__emblem"
        src={ANARCHY_EMBLEM_SRC}
        alt=""
        draggable={false}
      />
    ))}
  </div>
));

AnarchyEmblemRing.displayName = "AnarchyEmblemRing";
