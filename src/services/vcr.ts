import { spawn } from 'child_process'
import { mkdtempSync } from 'node:fs'
import * as fs from 'fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

interface TranscriptionResult {
  text: string
  confidence: number
  duration: number
}

class AudioTranscriber {
  private tempDir: string

  constructor(tempDir?: string) {
    this.tempDir = tempDir ?? tmpdir()
  }

  private createWavFromInt16Array(audioData: Int16Array, sampleRate: number = 16000, channels: number = 1): Buffer {
    const length = audioData.length
    const arrayBuffer = new ArrayBuffer(44 + length * 2)
    const view = new DataView(arrayBuffer)

    // WAV header
    const writeString = (offset: number, string: string): void => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }

    // RIFF header
    writeString(0, 'RIFF')
    view.setUint32(4, 36 + length * 2, true) // file size
    writeString(8, 'WAVE')

    // fmt chunk
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true) // chunk size
    view.setUint16(20, 1, true) // audio format (PCM)
    view.setUint16(22, channels, true) // number of channels
    view.setUint32(24, sampleRate, true) // sample rate
    view.setUint32(28, sampleRate * channels * 2, true) // byte rate
    view.setUint16(32, channels * 2, true) // block align
    view.setUint16(34, 16, true) // bits per sample

    // data chunk
    writeString(36, 'data')
    view.setUint32(40, length * 2, true) // data size

    // Write audio data
    for (let i = 0; i < length; i++) {
      view.setInt16(44 + i * 2, audioData?.[i] ?? 0, true)
    }

    return Buffer.from(arrayBuffer)
  }

  private async saveInt16ArrayAsWav(
    audioData: Int16Array,
    sampleRate: number = 16000,
    channels: number = 1
  ): Promise<string> {
    const wavBuffer = this.createWavFromInt16Array(audioData, sampleRate, channels)
    const outputPath = path.join(this.tempDir, `temp_${Date.now()}.wav`)

    await fs.writeFile(outputPath, wavBuffer)
    return outputPath
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private async validateAudioFile(filePath: string): Promise<void> {
    const exists = await this.fileExists(filePath)
    if (!exists) {
      throw new Error(`Audio file not found: ${filePath}`)
    }

    const ext = path.extname(filePath).toLowerCase()
    if (!['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm', '.mp4'].includes(ext)) {
      throw new Error(`Unsupported audio format: ${ext}. Supported: .wav .mp3 .m4a .flac .ogg .webm .mp4`)
    }
  }

  private async convertToWavToDir(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i',
        inputPath,
        '-acodec',
        'pcm_s16le',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-y',
        outputPath
      ])

      let errorOutput = ''

      ffmpeg.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString()
      })

      ffmpeg.on('close', (code: number) => {
        if (code === 0) {
          resolve(outputPath)
        } else {
          reject(new Error(`FFmpeg conversion failed: ${errorOutput}`))
        }
      })

      ffmpeg.on('error', (error: Error) => {
        reject(new Error(`FFmpeg spawn error: ${error.message}`))
      })
    })
  }

  private async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath)
    } catch (error) {
      console.warn(`Failed to cleanup temp file ${filePath}:`, error)
    }
  }

  // Transcribe Int16Array with local Whisper
  public async transcribeInt16ArrayWithLocalWhisper(
    audioData: Int16Array,
    sampleRate: number = 16000,
    channels: number = 1,
    model?: string
  ): Promise<TranscriptionResult> {
    const tempWavPath = await this.saveInt16ArrayAsWav(audioData, sampleRate, channels)

    try {
      return await this.transcribeWithLocalWhisper(tempWavPath, model)
    } finally {
      await this.cleanupTempFile(tempWavPath)
    }
  }
  public async transcribeWithLocalWhisper(
    filePath: string,
    model?: string
  ): Promise<TranscriptionResult> {
    await this.validateAudioFile(filePath)

    let wavPath = filePath
    let shouldCleanupWav = false

    // Run-specific dir so we know where whisper-cli writes and avoid path assumptions
    const runDir = mkdtempSync(path.join(tmpdir(), 'cale-whisper-'))

    // Convert to WAV if needed (into runDir so input and output are in same place)
    if (path.extname(filePath).toLowerCase() !== '.wav') {
      const convertedPath = path.join(runDir, `input_${Date.now()}.wav`)
      wavPath = await this.convertToWavToDir(filePath, convertedPath)
      shouldCleanupWav = true
    }

    const baseName = path.basename(wavPath, path.extname(wavPath))
    const outputPathNoExt = path.join(runDir, baseName)

    return new Promise((resolve, reject) => {
      const modelPath = (model ?? process.env.CALE_WHISPER_MODEL)?.trim()
      if (!modelPath) {
        void fs.rm(runDir, { recursive: true, force: true }).catch(() => {})
        reject(
          new Error(
            'No Whisper model configured. Set CALE_WHISPER_MODEL to the path of a .bin model file.\n' +
              'Download from: https://github.com/ggml-org/whisper.cpp#sample-audio-files\n' +
              'Example: export CALE_WHISPER_MODEL=/path/to/ggml-base.en.bin'
          )
        )
        return
      }

      const libPath = process.env.CALE_WHISPER_LIB_PATH ?? process.env.DYLD_LIBRARY_PATH
      const env = { ...process.env }
      if (libPath) {
        env.DYLD_LIBRARY_PATH = [libPath, env.DYLD_LIBRARY_PATH].filter(Boolean).join(path.delimiter)
      }
      const whisperBin = process.env.CALE_WHISPER_CLI?.trim() || 'whisper-cli'
      const args = [wavPath, '--output-json', '--output-file', outputPathNoExt, '--model', modelPath]
      if (process.env.CALE_STT_VERBOSE === '1' || process.env.CALE_STT_VERBOSE === 'true') {
        const cmd = [whisperBin, ...args].join(' ')
        console.warn('[cale stt verbose] runDir:', runDir)
        console.warn('[cale stt verbose] wavPath:', wavPath)
        console.warn('[cale stt verbose] outputPathNoExt:', outputPathNoExt)
        console.warn('[cale stt verbose] expected JSON:', `${outputPathNoExt}.json`)
        console.warn('[cale stt verbose] command:', cmd)
      }
      const whisper = spawn(whisperBin, args, { env })

      let errorOutput = ''

      const verbose = process.env.CALE_STT_VERBOSE === '1' || process.env.CALE_STT_VERBOSE === 'true'
      whisper.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString()
        errorOutput += chunk
        if (verbose) console.warn('[whisper stderr]', chunk)
      })

      whisper.on('close', async (code: number) => {
        try {
          if (verbose) {
            console.warn('[cale stt verbose] whisper exit code:', code)
            if (errorOutput.trim()) console.warn('[cale stt verbose] stderr summary:', errorOutput.trim().slice(-800))
          }
          const expectedInRunDir = `${outputPathNoExt}.json`
          const expectedNextToInput = path.join(path.dirname(wavPath), `${baseName}.json`)

          let jsonPath: string
          try {
            await fs.access(expectedInRunDir)
            jsonPath = expectedInRunDir
            if (verbose) console.warn('[cale stt verbose] using JSON:', jsonPath)
          } catch {
            try {
              await fs.access(expectedNextToInput)
              jsonPath = expectedNextToInput
              if (verbose) console.warn('[cale stt verbose] using JSON (next to input):', jsonPath)
            } catch {
              const entries = await fs.readdir(runDir)
              const jsonFile = entries.find((e) => e.endsWith('.json'))
              if (jsonFile) {
                jsonPath = path.join(runDir, jsonFile)
                if (verbose) console.warn('[cale stt verbose] using JSON (from runDir):', jsonPath)
              }
              if (!jsonFile) {
                if (code !== 0) {
                  const hasRealError =
                    /libwhisper.*\.dylib.*no such file/i.test(errorOutput) ||
                    /DYLD_LIBRARY_PATH/i.test(errorOutput) ||
                    /failed to (open|initialize)/i.test(errorOutput) ||
                    /\berror:\s+/i.test(errorOutput)
                  if (hasRealError) {
                    let hint = ''
                    if (/libwhisper.*\.dylib.*no such file/i.test(errorOutput) || /DYLD_LIBRARY_PATH/i.test(errorOutput)) {
                      hint = '\nSet CALE_WHISPER_LIB_PATH to the directory containing libwhisper.1.dylib (e.g. from whisper.cpp build), or run with DYLD_LIBRARY_PATH set.'
                    } else if (/failed to (open|initialize)/i.test(errorOutput)) {
                      hint = '\nSet CALE_WHISPER_MODEL to the path of a Whisper model file (e.g. a .bin from https://github.com/ggml-org/whisper.cpp#sample-audio-files).'
                    }
                    const lines = errorOutput.trim().split(/\r?\n/)
                    const errorLines = lines.filter((l) => /error|failed|warning:/i.test(l))
                    const summary =
                      errorLines.length > 0
                        ? errorLines.join('\n')
                        : lines.slice(-8).join('\n').trim() || errorOutput.slice(-500)
                    throw new Error(`Whisper failed: ${summary}${hint}`)
                  }
                  await fs.rm(runDir, { recursive: true, force: true }).catch(() => {})
                  resolve({ text: '', confidence: 0.9, duration: 0 })
                  return
                }
                throw new Error(`Whisper did not write a JSON file in ${runDir}`)
              }
              jsonPath = path.join(runDir, jsonFile)
            }
          }

          const jsonContent = await fs.readFile(jsonPath, 'utf-8')
          const result = JSON.parse(jsonContent) as {
            text?: string
            segments?: Array<{ start: number; end: number }>
            transcription?: Array<{ text?: string; offsets?: { from: number; to: number } }>
          }

          // whisper.cpp uses result.transcription[].text; other backends may use result.text / result.segments
          const textFromTranscription =
            result.transcription && result.transcription.length > 0
              ? result.transcription.map((s) => (s.text ?? '').trim()).join(' ').trim()
              : ''
          const text = (result.text ?? textFromTranscription).trim()

          const duration =
            result.segments && result.segments.length > 0
              ? Math.max(...result.segments.map((s) => s.end))
              : result.transcription && result.transcription.length > 0
                ? Math.max(...result.transcription.map((s) => (s.offsets?.to ?? 0) / 1000))
                : 0

          await this.cleanupTempFile(jsonPath)
          if (shouldCleanupWav) await this.cleanupTempFile(wavPath)
          await fs.rm(runDir, { recursive: true, force: true }).catch(() => {})

          resolve({
            text,
            confidence: 0.9,
            duration
          })
        } catch (error) {
          if (shouldCleanupWav) await this.cleanupTempFile(wavPath)
          await fs.rm(runDir, { recursive: true, force: true }).catch(() => {})
          reject(error)
        }
      })

      whisper.on('error', async (error: Error) => {
        if (shouldCleanupWav) await this.cleanupTempFile(wavPath)
        await fs.rm(runDir, { recursive: true, force: true }).catch(() => {})
        reject(new Error(`Whisper spawn error: ${error.message}`))
      })
    })
  }
}

// Main transcription function for Int16Array
export async function transcribeInt16Array(
  audioData: Int16Array,
  options: {
    service: 'whisper'
    model?: string
    tempDir?: string
    sampleRate?: number
    channels?: number
  }
): Promise<string> {
  const transcriber = new AudioTranscriber(options.tempDir)
  const sampleRate = options.sampleRate ?? 16000
  const channels = options.channels ?? 1

  try {
    const result = await transcriber.transcribeInt16ArrayWithLocalWhisper(
      audioData,
      sampleRate,
      channels,
      options.model
    )

    return result.text
  } catch (error) {
    const err = error as Error
    throw new Error(`Transcription failed: ${err.message}`)
  }
}

// Main transcription function with multiple service options
export async function transcribeAudioFile(
  filePath: string,
  options: {
    service: 'whisper'
    model?: string
    tempDir?: string
  }
): Promise<string> {
  const transcriber = new AudioTranscriber(options.tempDir)

  try {
    const result = await transcriber.transcribeWithLocalWhisper(filePath, options.model)

    return result.text
  } catch (error) {
    const err = error as Error
    throw new Error(`Transcription failed: ${err.message}`)
  }
}
