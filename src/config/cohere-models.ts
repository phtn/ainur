/**
 * Cohere model catalog derived from docs/cohere/get-models.md
 * Fetched via GET https://api.cohere.com/v1/models
 * Keep in sync by re-running: curl https://api.cohere.com/v1/models -H "Authorization: Bearer $COHERE_API_KEY"
 */

export interface CohereModel {
  name: string
  endpoints: string[]
  finetuned: boolean
  context_length: number
  tokenizer_url: string | null
  features: string[] | null
  default_endpoints: string[]
  sampling_defaults?: {
    temperature: number
    p: number
  }
}

export const COHERE_MODELS: CohereModel[] = [
  {
    name: "c4ai-aya-expanse-32b",
    endpoints: ["generate", "chat"],
    finetuned: false,
    context_length: 128000,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/c4ai-aya-expanse-32b.json",
    features: null,
    default_endpoints: [],
  },
  {
    name: "c4ai-aya-vision-32b",
    endpoints: ["chat"],
    finetuned: false,
    context_length: 16384,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/c4ai-aya-vision-32b.json",
    features: ["logprobs", "vision", "citations"],
    default_endpoints: [],
  },
  {
    name: "cohere-transcribe-03-2026",
    endpoints: ["transcriptions"],
    finetuned: false,
    context_length: 32768,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/cohere-transcribe-03-2026.json",
    features: null,
    default_endpoints: [],
  },
  {
    name: "command-a-03-2025",
    endpoints: ["chat"],
    finetuned: false,
    context_length: 288000,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/command-a-03-2025.json",
    features: ["json_mode", "json_schema", "strict_tools", "safety_modes", "tools", "tool_choice", "citations"],
    default_endpoints: ["chat", "generate"],
  },
  {
    name: "command-a-plus-05-2026",
    endpoints: ["generate", "chat"],
    finetuned: false,
    context_length: 436000,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/command-a-plus-05-2026.json",
    features: ["logprobs", "json_mode", "json_schema", "strict_tools", "safety_modes", "tools", "reasoning", "vision", "tool_images", "citations"],
    default_endpoints: [],
    sampling_defaults: { temperature: 0.6, p: 0.95 },
  },
  {
    name: "command-a-reasoning-08-2025",
    endpoints: ["chat"],
    finetuned: false,
    context_length: 288768,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/command-a-reasoning-08-2025.json",
    features: ["json_mode", "json_schema", "strict_tools", "safety_modes", "tools", "reasoning", "citations"],
    default_endpoints: [],
    sampling_defaults: { temperature: 0.6, p: 0.95 },
  },
  {
    name: "command-a-translate-08-2025",
    endpoints: ["chat"],
    finetuned: false,
    context_length: 8992,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/command-a-translate-08-2025.json",
    features: ["json_mode", "json_schema", "safety_modes", "tools", "tool_choice", "citations"],
    default_endpoints: [],
  },
  {
    name: "command-a-vision-07-2025",
    endpoints: ["chat"],
    finetuned: false,
    context_length: 128000,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/command-a-vision-07-2025.json",
    features: ["vision", "logprobs", "json_mode", "json_schema", "strict_tools", "safety_modes", "citations"],
    default_endpoints: [],
  },
  {
    name: "command-r-08-2024",
    endpoints: ["generate", "chat", "summarize"],
    finetuned: false,
    context_length: 128000,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/command-r-08-2024.json",
    features: ["logprobs", "json_mode", "json_schema", "strict_tools", "safety_modes", "tools", "tool_choice", "citations"],
    default_endpoints: [],
  },
  {
    name: "command-r-plus-08-2024",
    endpoints: ["generate", "chat", "summarize"],
    finetuned: false,
    context_length: 128000,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/command-r-plus-08-2024.json",
    features: ["logprobs", "json_mode", "json_schema", "strict_tools", "safety_modes", "tools", "tool_choice", "citations"],
    default_endpoints: [],
  },
  {
    name: "command-r7b-12-2024",
    endpoints: ["generate", "chat"],
    finetuned: false,
    context_length: 132000,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/command-r7b-12-2024.json",
    features: ["logprobs", "json_mode", "json_schema", "strict_tools", "safety_modes", "tools", "tool_choice", "citations"],
    default_endpoints: [],
  },
  {
    name: "command-r7b-arabic-02-2025",
    endpoints: ["generate", "chat"],
    finetuned: false,
    context_length: 128000,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/command-r7b-arabic-02-2025.json",
    features: ["logprobs", "json_mode", "json_schema", "strict_tools", "safety_modes", "tools", "tool_choice", "citations"],
    default_endpoints: [],
  },
  {
    name: "embed-english-light-v3.0",
    endpoints: ["embed"],
    finetuned: false,
    context_length: 512,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/embed-english-light-v3.0.json",
    features: null,
    default_endpoints: [],
  },
  {
    name: "embed-english-light-v3.0-image",
    endpoints: ["embed_image"],
    finetuned: false,
    context_length: 0,
    tokenizer_url: null,
    features: null,
    default_endpoints: [],
  },
  {
    name: "embed-english-v3.0",
    endpoints: ["embed"],
    finetuned: false,
    context_length: 512,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/embed-english-v3.0.json",
    features: null,
    default_endpoints: [],
  },
  {
    name: "embed-english-v3.0-image",
    endpoints: ["embed_image"],
    finetuned: false,
    context_length: 0,
    tokenizer_url: null,
    features: null,
    default_endpoints: [],
  },
  {
    name: "embed-multilingual-light-v3.0",
    endpoints: ["embed"],
    finetuned: false,
    context_length: 512,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/embed-multilingual-light-v3.0.json",
    features: null,
    default_endpoints: [],
  },
  {
    name: "embed-multilingual-light-v3.0-image",
    endpoints: ["embed_image"],
    finetuned: false,
    context_length: 0,
    tokenizer_url: null,
    features: null,
    default_endpoints: [],
  },
  {
    name: "embed-multilingual-v3.0",
    endpoints: ["embed"],
    finetuned: false,
    context_length: 512,
    tokenizer_url: "https://storage.googleapis.com/cohere-public/tokenizers/embed-multilingual-v3.0.json",
    features: null,
    default_endpoints: [],
  },
  {
    name: "embed-multilingual-v3.0-image",
    endpoints: ["embed_image"],
    finetuned: false,
    context_length: 0,
    tokenizer_url: null,
    features: null,
    default_endpoints: [],
  },
]

/** Models usable for chat/generate — filtered from the full catalog */
export const COHERE_CHAT_MODELS = COHERE_MODELS.filter((m) => m.endpoints.includes("chat") || m.endpoints.includes("generate"))

/** Fast lookup for context length by model name */
export const COHERE_CONTEXT_LENGTHS: Record<string, number> = Object.fromEntries(
  COHERE_MODELS.map((m) => [m.name, m.context_length]),
)

/** Sort chat models by recommendation: Command A family first, then R family, then Aya */
const MODEL_PRIORITY: Record<string, number> = {
  "command-a-plus-05-2026": 0,
  "command-a-03-2025": 1,
  "command-a-reasoning-08-2025": 2,
  "command-a-vision-07-2025": 3,
  "command-a-translate-08-2025": 4,
  "command-r-plus-08-2024": 5,
  "command-r-08-2024": 6,
  "command-r7b-12-2024": 7,
  "command-r7b-arabic-02-2025": 8,
  "c4ai-aya-expanse-32b": 9,
  "c4ai-aya-vision-32b": 10,
}

export const COHERE_CHAT_MODELS_SORTED = [...COHERE_CHAT_MODELS].sort(
  (a, b) => (MODEL_PRIORITY[a.name] ?? 99) - (MODEL_PRIORITY[b.name] ?? 99),
)

export function isCohereChatModel(name: string): boolean {
  return COHERE_CHAT_MODELS.some((m) => m.name === name)
}

export function getCohereModel(name: string): CohereModel | undefined {
  return COHERE_MODELS.find((m) => m.name === name)
}
