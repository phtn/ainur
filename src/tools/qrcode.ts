import { tool } from "ai";
import QRCode from "qrcode";
import { z } from "zod";

export type QRCodePayloadKind = "url" | "crypto-address" | "text";

export interface QRCodePayload {
  kind: QRCodePayloadKind;
  payload: string;
}

const EVM_HEX_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function normalizeQRCodePayload(input: string): QRCodePayload {
  const value = input.trim();
  if (!value) return { kind: "text", payload: value };

  if (EVM_HEX_ADDRESS_PATTERN.test(value)) {
    return { kind: "crypto-address", payload: value };
  }

  try {
    new URL(value);
    return { kind: "url", payload: value };
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      return { kind: "url", payload: value };
    }

    if (/^[^\s]+\.[^\s]+$/.test(value)) {
      return { kind: "url", payload: `https://${value}` };
    }

    return { kind: "text", payload: value };
  }
}

export interface QRCodeResult {
  input: string;
  kind: QRCodePayloadKind;
  payload: string;
  link: string;
  qrCode: string;
}

export async function generateQRCode(input: string): Promise<QRCodeResult> {
  const normalized = normalizeQRCodePayload(input);
  const qrCode = await QRCode.toString(normalized.payload, {
    type: "utf8",
    errorCorrectionLevel: "M",
  });

  return {
    input,
    kind: normalized.kind,
    payload: normalized.payload,
    link: normalized.payload,
    qrCode,
  };
}

export const qrCodeTool = tool({
  description:
    "Generate a QR code for a URL, crypto wallet address, or text so the user can scan it.",
  inputSchema: z.object({
    link: z.string().min(1).describe("The URL, crypto wallet address, or text to encode into a QR code"),
  }),
  execute: async ({ link }) => {
    return generateQRCode(link);
  },
});
