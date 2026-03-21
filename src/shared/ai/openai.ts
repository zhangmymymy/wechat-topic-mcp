import OpenAI from "openai";
import type { AIProvider, AnalysisResult, Message } from "../types.js";
import { buildAnalysisPrompt, buildMergePrompt } from "./prompts.js";

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    this.client = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
    this.model = model;
  }

  async analyze(messages: Message[], keyword: string): Promise<AnalysisResult> {
    const prompt = buildAnalysisPrompt(messages, keyword);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");
    return JSON.parse(content) as AnalysisResult;
  }

  async mergeReports(reports: AnalysisResult[], keyword: string): Promise<AnalysisResult> {
    const segmentData = reports.map((r) => ({ ...r.report, keyword }));
    const prompt = buildMergePrompt(segmentData);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty AI merge response");
    return JSON.parse(content) as AnalysisResult;
  }
}
