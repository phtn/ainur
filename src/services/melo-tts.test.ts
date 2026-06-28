import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchMeloTtsLanguages,
  fetchMeloTtsVoices,
  getMeloTtsVoiceSelector,
  resolveMeloTtsVoiceId,
  runMeloTts,
} from "./melo-tts.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchMeloTtsVoices", () => {
  it("loads uploaded voices from the MeloTTS service", async () => {
    globalThis.fetch = (async (url) => {
      expect(String(url)).toBe("http://melo.local/voices");
      return Response.json({
        voices: [
          { voice_id: "voice-a", name: "Narrator A" },
          { id: "voice-b", label: "Narrator B" },
        ],
      });
    }) as typeof fetch;

    const result = await fetchMeloTtsVoices("http://melo.local/");

    expect(result.error).toBeUndefined();
    expect(result.sourceUrl).toBe("http://melo.local/voices");
    expect(result.items).toEqual([
      { id: "voice-a", name: "Narrator A" },
      { id: "voice-b", name: "Narrator B" },
    ]);
  });
});

describe("MeloTTS voice selection", () => {
  it("uses the first id segment as the human-friendly selector", () => {
    expect(getMeloTtsVoiceSelector("theron-edf501e0cc")).toBe("theron");
    expect(getMeloTtsVoiceSelector("plainvoice")).toBe("plainvoice");
  });

  it("resolves a short selector to the full voice id", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        voices: [
          { id: "theron-edf501e0cc", name: "theron", embedding_ready: true },
          { id: "natalie-e3af29851b", name: "natalie", embedding_ready: true },
        ],
      })) as unknown as typeof fetch;

    await expect(resolveMeloTtsVoiceId("theron", "http://melo.local")).resolves.toEqual({
      ok: true,
      voiceId: "theron-edf501e0cc",
      selector: "theron",
    });
  });

  it("prefers the embedding-ready voice when a short selector has duplicates", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        voices: [
          { id: "emma-bbb2866eb3", name: "emma", embedding_ready: false },
          { id: "emma-b47b081277", name: "emma", embedding_ready: true },
        ],
      })) as unknown as typeof fetch;

    await expect(resolveMeloTtsVoiceId("emma", "http://melo.local")).resolves.toEqual({
      ok: true,
      voiceId: "emma-b47b081277",
      selector: "emma",
    });
  });
});

describe("fetchMeloTtsLanguages", () => {
  it("loads language codes and default speakers from the MeloTTS service", async () => {
    globalThis.fetch = (async (url) => {
      expect(String(url)).toBe("http://melo.local/languages");
      return Response.json({
        languages: {
          EN_NEWEST: { default_speaker: "en-default" },
          ES: { speaker_id: "es-default" },
        },
      });
    }) as typeof fetch;

    const result = await fetchMeloTtsLanguages("http://melo.local");

    expect(result.error).toBeUndefined();
    expect(result.sourceUrl).toBe("http://melo.local/languages");
    expect(result.items).toEqual([
      { code: "EN_NEWEST", speaker: "en-default" },
      { code: "ES", speaker: "es-default" },
    ]);
  });
});

describe("runMeloTts", () => {
  it("posts synthesis options, downloads the returned audio URL, and writes a WAV", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "cale-melo-tts-test-"));
    const wavPath = join(tmpDir, "speech.wav");
    const fetchUrls: string[] = [];
    let synthesizeBody: unknown;

    globalThis.fetch = (async (url, init) => {
      fetchUrls.push(String(url));
      if (String(url) === "http://melo.local/synthesize") {
        synthesizeBody = JSON.parse(String(init?.body));
        return Response.json({ audio: { audio_url: "/audio/generated.wav" } });
      }
      if (String(url) === "http://melo.local/audio/generated.wav") {
        return new Response(new Uint8Array([82, 73, 70, 70]), {
          headers: { "content-type": "audio/wav" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
      const result = await runMeloTts("Hello from Cale.", wavPath, {
        endpoint: "http://melo.local/",
        voiceId: "voice-a",
        language: "EN_NEWEST",
        speed: 1.25,
      });

      expect(result).toEqual({
        ok: true,
        stderr: "",
        audioUrl: "http://melo.local/audio/generated.wav",
      });
      expect(fetchUrls).toEqual(["http://melo.local/synthesize", "http://melo.local/audio/generated.wav"]);
      expect(synthesizeBody).toEqual({
        voice_id: "voice-a",
        text: "Hello from Cale.",
        language: "EN_NEWEST",
        speed: 1.25,
      });
      expect(Array.from(readFileSync(wavPath))).toEqual([82, 73, 70, 70]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
