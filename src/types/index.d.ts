declare module 'node-record-lpcm16' {
  import type { Readable } from 'stream'
  interface RecordOptions {
    sampleRate?: number
    channels?: number
    audioType?: string
    threshold?: number
    thresholdStart?: number
    thresholdEnd?: number
    silence?: number
    recorder?: string
    endOnSilence?: boolean
    device?: string
  }

  interface Recorder {
    stream(): Readable
    stop(): void
  }

  interface RecorderStatic {
    record(options?: RecordOptions): Recorder
  }

  const recorder: RecorderStatic
  export default recorder
}

declare module '@babel/traverse' {
  export type TraverseVisitor = Record<string, (path: any) => void>

  export default function traverse(ast: any, visitors: TraverseVisitor): void
}
