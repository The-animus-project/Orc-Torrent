import { describe, expect, it } from "vitest";
import { buildProfilePolicy } from "./usePolicy";

describe("MSE/PE profile consent", () => {
  it("does not infer consent from a hardened profile", () => {
    const policy = buildProfilePolicy("hardened");
    expect(policy.peer_encryption).toBe("require");
    expect(policy.peer_encryption_opt_in).toBe(false);
    expect(policy.engine.transports.utp).toBe(true);
  });

  it("preserves consent that the user already recorded", () => {
    const current = buildProfilePolicy("standard");
    current.peer_encryption_opt_in = true;
    expect(buildProfilePolicy("hardened", current).peer_encryption_opt_in).toBe(true);
  });
});
