import { tool } from "ai";
import QRCode from "qrcode";
import { z } from "zod";

function normalizeLink(link: string): string {
  const value = link.trim();
  if (!value) return value;

  try {
    new URL(value);
    return value;
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
    return `https://${value}`;
  }
}

export async function generateQRCode(link: string): Promise<{ link: string; qrCode: string }> {
  const normalizedLink = normalizeLink(link);
  const qrCode = await QRCode.toString(normalizedLink, {
    type: "utf8",
    errorCorrectionLevel: "M",
  });

  return {
    link: normalizedLink,
    qrCode,
  };
}

export const qrCodeTool = tool({
  description:
    "Generate a QR code for a link or URL so the user can scan it. Use when the user wants a link turned into a QR code.",
  inputSchema: z.object({
    link: z.string().min(1).describe("The link or URL to encode into a QR code"),
  }),
  execute: async ({ link }) => {
    return generateQRCode(link);
  },
});
