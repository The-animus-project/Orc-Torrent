import React, { memo } from "react";

const HEARTS = ["💕", "💗", "💖", "💗", "💕", "💖", "💗", "💕"] as const;

export const KawaiiHeartRing = memo(() => (
  <div className="kawaiiHeartRing" aria-hidden="true">
    {HEARTS.map((heart, index) => (
      <span key={index} className="kawaiiHeartRing__heart">
        {heart}
      </span>
    ))}
  </div>
));

KawaiiHeartRing.displayName = "KawaiiHeartRing";
