import React, { memo } from "react";

const ANARCHY_EMBLEM_SRC = "./images/animus/anarchy-emblem.png";

export type AnarchyToastIconPhase = "default" | "loading" | "success" | "error";

interface AnarchyToastIconProps {
  phase?: AnarchyToastIconPhase;
}

export const AnarchyToastIcon = memo<AnarchyToastIconProps>(({ phase = "default" }) => (
  <img
    className={`anarchyToastIcon${phase !== "default" ? ` anarchyToastIcon--${phase}` : ""}`}
    src={ANARCHY_EMBLEM_SRC}
    alt=""
    draggable={false}
  />
));

AnarchyToastIcon.displayName = "AnarchyToastIcon";
