import { tool } from 'ai'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

export function generateUUIDv7(count = 1): string[] {
  return Array.from({ length: count }, () => uuidv7())
}

export const uuidV7Tool = tool({
  description: 'Generate one or more UUIDv7 values. Use when a user needs a time-sortable unique ID.',
  inputSchema: z.object({
    count: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(1)
      .describe('Number of UUIDv7 values to generate'),
  }),
  execute: async ({ count }) => {
    const uuids = generateUUIDv7(count)
    return count === 1 ? { uuid: uuids[0] } : { uuids }
  },
})
