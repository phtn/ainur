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

declare module 'qrcode' {
  export interface QRCodeToStringOptions {
    type?: 'utf8' | 'terminal' | 'svg' | 'txt' | 'png'
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  }

  export interface QRCodeToDataURLOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  }

  export function toString(text: string, options?: QRCodeToStringOptions): Promise<string>
  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>

  const QRCode: {
    toString: typeof toString
    toDataURL: typeof toDataURL
  }

  export default QRCode
}
