import { describe, expect, it } from "bun:test";
import { generateQRCode, normalizeQRCodePayload } from "./qrcode.ts";

describe("normalizeQRCodePayload", () => {
  it("keeps EVM hex addresses raw for wallet scanners", () => {
    const address = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

    expect(normalizeQRCodePayload(address)).toEqual({
      kind: "crypto-address",
      payload: address,
    });
  });

  it("normalizes bare domains as HTTPS URLs", () => {
    expect(normalizeQRCodePayload("example.com")).toEqual({
      kind: "url",
      payload: "https://example.com",
    });
  });

  it("leaves plain text as plain text", () => {
    expect(normalizeQRCodePayload("hello wallet")).toEqual({
      kind: "text",
      payload: "hello wallet",
    });
  });
});

describe("generateQRCode", () => {
  it("encodes crypto addresses without adding a URL scheme", async () => {
    const address = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
    const result = await generateQRCode(address);

    expect(result.kind).toBe("crypto-address");
    expect(result.payload).toBe(address);
    expect(result.link).toBe(address);
    expect(result.qrCode.length).toBeGreaterThan(0);
  });
});
