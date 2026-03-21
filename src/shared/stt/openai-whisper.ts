// src/shared/stt/openai-whisper.ts
import OpenAI, { toFile } from "openai";
import type { STTProvider } from "../types.js";

export class WhisperSTTProvider implements STTProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = "whisper-1") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async transcribe(audioUrl: string): Promise<string> {
    // Download audio file
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const file = await toFile(buffer, "audio.amr", { type: "audio/amr" });

    const transcription = await this.client.audio.transcriptions.create({
      model: this.model,
      file,
      language: "zh",
    });

    return transcription.text;
  }
}
