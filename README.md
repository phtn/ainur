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

## Speech I/O (Rhasspy + OpenAI)

Current defaults:

- `sttProvider`: `openai` (uses OpenAI Whisper `whisper-1`)
- `sttEndpoint`: `http://localhost:5002/api/speech-to-text` (used when `sttProvider=endpoint`)
- `ttsProvider`: `endpoint`
- `ttsEndpoint`: `http://localhost:5002/api/text-to-speech?speakerId=hot-moody`

Rhasspy endpoint usage:

```bash
cale config set sttProvider endpoint
cale config set sttEndpoint http://localhost:5002/api/speech-to-text
cale tts endpoint http://localhost:5002/api/text-to-speech?speakerId=hot-moody
cale tts voice list
cale tts voice <speakerId>
```

OpenAI STT usage (default):

```bash
cale config set sttProvider openai
cale config set apiKey <your-openai-key>
```

Piper local TTS setup:

```bash
cale tts install
```

Additional speech config keys:

- `sttProvider` (`openai|endpoint`)
- `sttEndpoint` (URL)
- `ttsProvider` (`endpoint|piper`)
- `ttsEndpoint` (URL)
- `ttsModel` (local `.onnx` path for Piper)
