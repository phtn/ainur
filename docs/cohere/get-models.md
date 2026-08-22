## GET
```zsh
curl https://api.cohere.com/v1/models \
     -H "Authorization: Bearer cohere_lcZwmgGMIWSLUmwdR1rFYoPcYsZYSPLJE2YFkSkC30k0I2"
```
## Response
```json

{
  "models": [
    {
      "name": "c4ai-aya-expanse-32b",
      "endpoints": [
        "generate",
        "chat"
      ],
      "finetuned": false,
      "context_length": 128000,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/c4ai-aya-expanse-32b.json",
      "features": null,
      "default_endpoints": []
    },
    {
      "name": "c4ai-aya-vision-32b",
      "endpoints": [
        "chat"
      ],
      "finetuned": false,
      "context_length": 16384,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/c4ai-aya-vision-32b.json",
      "features": [
        "logprobs",
        "vision",
        "citations"
      ],
      "default_endpoints": []
    },
    {
      "name": "cohere-transcribe-03-2026",
      "endpoints": [
        "transcriptions"
      ],
      "finetuned": false,
      "context_length": 32768,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/cohere-transcribe-03-2026.json",
      "features": null,
      "default_endpoints": []
    },
    {
      "name": "command-a-03-2025",
      "endpoints": [
        "chat"
      ],
      "finetuned": false,
      "context_length": 288000,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/command-a-03-2025.json",
      "features": [
        "json_mode",
        "json_schema",
        "strict_tools",
        "safety_modes",
        "tools",
        "tool_choice",
        "citations"
      ],
      "default_endpoints": [
        "chat",
        "generate"
      ]
    },
    {
      "name": "command-a-plus-05-2026",
      "endpoints": [
        "generate",
        "chat"
      ],
      "finetuned": false,
      "context_length": 436000,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/command-a-plus-05-2026.json",
      "features": [
        "logprobs",
        "json_mode",
        "json_schema",
        "strict_tools",
        "safety_modes",
        "tools",
        "reasoning",
        "vision",
        "tool_images",
        "citations"
      ],
      "default_endpoints": [],
      "sampling_defaults": {
        "temperature": 0.6,
        "p": 0.95
      }
    },
    {
      "name": "command-a-reasoning-08-2025",
      "endpoints": [
        "chat"
      ],
      "finetuned": false,
      "context_length": 288768,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/command-a-reasoning-08-2025.json",
      "features": [
        "json_mode",
        "json_schema",
        "strict_tools",
        "safety_modes",
        "tools",
        "reasoning",
        "citations"
      ],
      "default_endpoints": [],
      "sampling_defaults": {
        "temperature": 0.6,
        "p": 0.95
      }
    },
    {
      "name": "command-a-translate-08-2025",
      "endpoints": [
        "chat"
      ],
      "finetuned": false,
      "context_length": 8992,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/command-a-translate-08-2025.json",
      "features": [
        "json_mode",
        "json_schema",
        "safety_modes",
        "tools",
        "tool_choice",
        "citations"
      ],
      "default_endpoints": []
    },
    {
      "name": "command-a-vision-07-2025",
      "endpoints": [
        "chat"
      ],
      "finetuned": false,
      "context_length": 128000,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/command-a-vision-07-2025.json",
      "features": [
        "vision",
        "logprobs",
        "json_mode",
        "json_schema",
        "strict_tools",
        "safety_modes",
        "citations"
      ],
      "default_endpoints": []
    },
    {
      "name": "command-r-08-2024",
      "endpoints": [
        "generate",
        "chat",
        "summarize"
      ],
      "finetuned": false,
      "context_length": 128000,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/command-r-08-2024.json",
      "features": [
        "logprobs",
        "json_mode",
        "json_schema",
        "strict_tools",
        "safety_modes",
        "tools",
        "tool_choice",
        "citations"
      ],
      "default_endpoints": []
    },
    {
      "name": "command-r-plus-08-2024",
      "endpoints": [
        "generate",
        "chat",
        "summarize"
      ],
      "finetuned": false,
      "context_length": 128000,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/command-r-plus-08-2024.json",
      "features": [
        "logprobs",
        "json_mode",
        "json_schema",
        "strict_tools",
        "safety_modes",
        "tools",
        "tool_choice",
        "citations"
      ],
      "default_endpoints": []
    },
    {
      "name": "command-r7b-12-2024",
      "endpoints": [
        "generate",
        "chat"
      ],
      "finetuned": false,
      "context_length": 132000,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/command-r7b-12-2024.json",
      "features": [
        "logprobs",
        "json_mode",
        "json_schema",
        "strict_tools",
        "safety_modes",
        "tools",
        "tool_choice",
        "citations"
      ],
      "default_endpoints": []
    },
    {
      "name": "command-r7b-arabic-02-2025",
      "endpoints": [
        "generate",
        "chat"
      ],
      "finetuned": false,
      "context_length": 128000,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/command-r7b-arabic-02-2025.json",
      "features": [
        "logprobs",
        "json_mode",
        "json_schema",
        "strict_tools",
        "safety_modes",
        "tools",
        "tool_choice",
        "citations"
      ],
      "default_endpoints": []
    },
    {
      "name": "embed-english-light-v3.0",
      "endpoints": [
        "embed"
      ],
      "finetuned": false,
      "context_length": 512,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/embed-english-light-v3.0.json",
      "features": null,
      "default_endpoints": []
    },
    {
      "name": "embed-english-light-v3.0-image",
      "endpoints": [
        "embed_image"
      ],
      "finetuned": false,
      "context_length": 0,
      "tokenizer_url": null,
      "features": null,
      "default_endpoints": []
    },
    {
      "name": "embed-english-v3.0",
      "endpoints": [
        "embed"
      ],
      "finetuned": false,
      "context_length": 512,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/embed-english-v3.0.json",
      "features": null,
      "default_endpoints": []
    },
    {
      "name": "embed-english-v3.0-image",
      "endpoints": [
        "embed_image"
      ],
      "finetuned": false,
      "context_length": 0,
      "tokenizer_url": null,
      "features": null,
      "default_endpoints": []
    },
    {
      "name": "embed-multilingual-light-v3.0",
      "endpoints": [
        "embed"
      ],
      "finetuned": false,
      "context_length": 512,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/embed-multilingual-light-v3.0.json",
      "features": null,
      "default_endpoints": []
    },
    {
      "name": "embed-multilingual-light-v3.0-image",
      "endpoints": [
        "embed_image"
      ],
      "finetuned": false,
      "context_length": 0,
      "tokenizer_url": null,
      "features": null,
      "default_endpoints": []
    },
    {
      "name": "embed-multilingual-v3.0",
      "endpoints": [
        "embed"
      ],
      "finetuned": false,
      "context_length": 512,
      "tokenizer_url": "https://storage.googleapis.com/cohere-public/tokenizers/embed-multilingual-v3.0.json",
      "features": null,
      "default_endpoints": []
    },
    {
      "name": "embed-multilingual-v3.0-image",
      "endpoints": [
        "embed_image"
      ],
      "finetuned": false,
      "context_length": 0,
      "tokenizer_url": null,
      "features": null,
      "default_endpoints": []
    }
  ]
}
```
