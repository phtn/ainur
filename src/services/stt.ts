import recorder from 'node-record-lpcm16'
import { out } from '../cli/output.ts'
import { transcribeInt16Array } from './vcr.ts'

export class STT_Service {
  private isRecording = false
  private readonly MIN_SAMPLES = 512

  async startRecording(): Promise<string> {
    return new Promise((resolve, reject) => {
      const rawChunks: Buffer[] = []
      const spinner = out.spinner

      spinner.start()
      this.isRecording = true

      const recording = recorder.record({
        sampleRate: 16000,
        channels: 1,
        audioType: 'raw',
        recorder: 'sox'
      })

      // Create cleanup function
      const cleanup = (): void => {
        if (this.isRecording) {
          this.isRecording = false
          recording.stop()
          spinner.stop()
        }

        if (process.stdin.isTTY) {
          process.stdin.removeAllListeners('data')
          process.stdin.setRawMode(false)
          process.stdin.pause()
        }
      }

      // Handle keyboard input
      const keyHandler = (key: Buffer): void => {
        const keyStr = key.toString()
        if (keyStr === 'q' || keyStr === '\u0003') {
          // 'q' or Ctrl+C
          if (this.isRecording) {
            cleanup()

            // Process the recorded audio
            this.processRecording(rawChunks).then(resolve).catch(reject)
          }
        }
      }

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
        process.stdin.resume()
        process.stdin.on('data', keyHandler)
      }

      recording
        .stream()
        .on('data', (chunk: Buffer | string) => {
          if (!this.isRecording) return
          rawChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'binary'))
        })
        .on('error', (err: Error) => {
          cleanup()
          reject(err)
        })
    })
  }

  private async processRecording(rawChunks: Buffer[]): Promise<string> {
    if (rawChunks.length === 0) {
      throw new Error('No audio data received')
    }

    const rawBuffer = Buffer.concat(rawChunks)
    const samples = new Int16Array(
      rawBuffer.buffer,
      rawBuffer.byteOffset,
      rawBuffer.length / Int16Array.BYTES_PER_ELEMENT
    )

    if (samples.length < this.MIN_SAMPLES) {
      throw new Error(`Recording too short. Need at least ${this.MIN_SAMPLES} samples, got ${samples.length}`)
    }

    return this.transcribe(samples)
  }

  public async transcribe(audioBuffer: Int16Array): Promise<string> {
    if (!(audioBuffer instanceof Int16Array)) {
      throw new Error('Audio buffer must be an Int16Array')
    }

    const spinner = out.spinner

    try {
      const result = await transcribeInt16Array(audioBuffer, { service: 'whisper' })
      spinner.stop()
      return result?.trim() ? result : 'Sorry, could not understand the audio'
    } catch (error) {
      spinner.stop()
      console.error('Transcription failed')
      throw error
    }
  }
}
