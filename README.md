# cale

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.6. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## API Gateway (auto-start)

When you run `cale` in app mode (`cale` REPL or `cale -p`), it now auto-starts a local API gateway.

- Default URL: `http://127.0.0.1:18889`
- Health: `GET /health`
- OpenAI-compatible endpoint: `POST /v1/chat/completions` (non-streaming for now)

Optional config keys (`cale config set <key> <value>`):

- `gatewayEnabled` (`true|false`)
- `gatewayAutoStart` (`true|false`)
- `gatewayPort` (`1..65535`)
- `gatewayBind` (`127.0.0.1`, `0.0.0.0`, `loopback`, `lan`, or host/IP)
- `gatewayToken` (Bearer token for API auth)

Manual gateway controls:

```bash
cale gateway start
cale gateway status
```

## Speech I/O (Rhasspy default)

Current defaults:

- `sttProvider`: `endpoint` (uses configured `sttEndpoint`, e.g. Rhasspy)
- `sttEndpoint`: `http://localhost:5002/api/speech-to-text`
- `ttsProvider`: `endpoint`
- `ttsEndpoint`: `http://localhost:5002/api/text-to-speech?speakerId=hot-moody`

Rhasspy endpoint usage (default):

```bash
cale config set sttEndpoint http://localhost:5002/api/speech-to-text
cale tts endpoint http://localhost:5002/api/text-to-speech?speakerId=hot-moody
cale tts voice list
cale tts voice <speakerId>
```

If you get **STT 404 (Not Found)**, the server at that URL doesn’t expose `/api/speech-to-text`. Point `sttEndpoint` at your actual STT service (e.g. Rhasspy often uses port **12101**: `cale config set sttEndpoint http://localhost:12101/api/speech-to-text`). You can have TTS on one host/port and STT on another.

OpenAI Whisper STT (optional):

```bash
cale config set sttProvider openai
cale config set apiKey <your-openai-key>
```

Piper local TTS setup:

```bash
cale tts install
```

**Local Whisper STT** (used by `cale stt` and REPL voice): requires `whisper-cli` on your PATH and a Whisper model file. On macOS you may need the native library (see below).

- **Model:** Set `CALE_WHISPER_MODEL` to the path of a `.bin` model (e.g. from [whisper.cpp](https://github.com/ggml-org/whisper.cpp#sample-audio-files)). If unset, `whisper-cli` uses its default (`models/ggml-base.en.bin` relative to its cwd).
- **Binary:** Optional `CALE_WHISPER_CLI`: path to the `whisper-cli` executable. Use the [vcr whisper.cpp build](https://github.com/ggml-org/whisper.cpp) binary (VAD off by default) if your system `whisper-cli` gives empty transcripts.
- **macOS dylib:** If you see `libwhisper.1.dylib (no such file)`:

```bash
export CALE_WHISPER_LIB_PATH=/path/to/whisper.cpp/build/src
export CALE_WHISPER_MODEL=/path/to/ggml-base.en.bin
# optional: use vcr build so VAD is off and you get a transcript
export CALE_WHISPER_CLI=/path/to/whisper.cpp/build/bin/whisper-cli
cale stt
```

Additional speech config keys:

- `sttProvider` (`endpoint` | `openai`)
- `sttEndpoint` (URL)
- `ttsProvider` (`endpoint|piper`)
- `ttsEndpoint` (URL)
- `ttsModel` (local `.onnx` path for Piper)
