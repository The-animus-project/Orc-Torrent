import { afterEach, describe, expect, it, vi } from "vitest";
import { configureDaemonApi, getJson } from "./api";

describe("runtime daemon API configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    configureDaemonApi({ baseUrl: "http://127.0.0.1:8733" });
  });

  it("uses the injected loopback URL and authenticates requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    configureDaemonApi({ baseUrl: "http://127.0.0.1:49152/", adminToken: "install-token" });

    await expect(getJson("/torrents")).resolves.toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:49152/torrents");
    expect(new Headers(options.headers).get("x-admin-token")).toBe("install-token");
  });

  it("uses the native desktop proxy without exposing authority or token", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    vi.stubGlobal("window", { orc: { daemon: { request } } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    configureDaemonApi({ baseUrl: "http://127.0.0.1:49152", adminToken: "renderer-must-not-forward-this" });

    await expect(getJson("/torrents?limit=2")).resolves.toEqual({ items: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/torrents?limit=2",
      body: undefined,
      headers: {},
    });
  });
});
