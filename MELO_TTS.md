# OpenVoice MeloTTS Voice Cloning Service

Dockerized FastAPI service for uploading reference voices, generating cloned speech with OpenVoice V2 + MeloTTS, and serving generated WAV files by URL for external apps.

## Run

```bash
docker compose up --build
```

Open `http://localhost:8000`.

The first synthesis can take several minutes because the service downloads OpenVoice V2 checkpoints into `./models`, loads the converter, extracts the reference speaker embedding, and warms the MeloTTS language model. Generated audio and uploaded voices are stored in `./data`.

## API

Upload a reference voice:

```bash
curl -F "name=Narrator A" -F "sample=@reference.wav" http://localhost:8000/voices
```

Generate hosted audio:

```bash
curl -X POST http://localhost:8000/synthesize \
  -H "Content-Type: application/json" \
  -d '{
    "voice_id": "VOICE_ID_FROM_UPLOAD",
    "text": "This audio is generated from a cloned reference voice.",
    "language": "EN_NEWEST",
    "speed": 1.0
  }'
```

The response includes `audio.audio_url`, which is a direct URL under `/audio/...wav`.

Useful endpoints:

- `GET /health` - API, storage, checkpoint, and model-load status.
- `GET /voices` - uploaded reference voices.
- `POST /voices` - multipart upload with `name` and `sample`.
- `POST /synthesize` - synchronous clone + TTS generation.
- `GET /audio-index` - generated audio history.
- `GET /languages` - supported language codes and default speakers.
- `GET /languages/{language}/speakers` - speaker IDs for a language; loads that MeloTTS model.

## Configuration

Environment variables:

- `PUBLIC_BASE_URL` - public base URL used in returned audio links. Set this when exposing through a tunnel, proxy, or hosted domain.
- `OPENVOICE_DEVICE` - `cpu`, `cuda:0`, or another device supported by PyTorch. The Dockerfile installs CPU PyTorch by default.
- `AUTO_DOWNLOAD_MODELS` - `true` downloads OpenVoice V2 checkpoints on first use.
- `MODEL_DIR` - checkpoint storage path inside the container.
- `DATA_DIR` - uploaded voices, speaker embeddings, and generated audio path.
- `MAX_UPLOAD_MB` - upload limit for reference audio.

## Notes

This follows the upstream OpenVoice V2 demo flow: MeloTTS generates base speech, OpenVoice extracts the uploaded target speaker embedding, and the tone-color converter creates the cloned output. The Mac-friendly deployment path is Docker, matching the MeloTTS install guide.
