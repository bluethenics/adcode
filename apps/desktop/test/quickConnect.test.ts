import { describe, expect, it } from "vitest";
import {
  FREE_GEMINI_MODEL,
  detectKeyProvider,
  looksLikeGeminiKey,
  preferredOllamaModel,
} from "../src/shared/quickConnect.ts";

const filler = (length: number, alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") =>
  Array.from({ length }, (_, index) => alphabet[index % alphabet.length]).join("");

describe("telling which provider a pasted key belongs to", () => {
  it("knows the keys that announce themselves", () => {
    expect(detectKeyProvider(`sk-ant-api03-${filler(80)}`)).toBe("anthropic");
    expect(detectKeyProvider(`sk-or-v1-${filler(64, "0123456789abcdef")}`)).toBe("openrouter");
    expect(detectKeyProvider(`gsk_${filler(52)}`)).toBe("groq");
    expect(detectKeyProvider(`xai-${filler(80)}`)).toBe("xai");
    expect(detectKeyProvider(`csk-${filler(48)}`)).toBe("cerebras");
    expect(detectKeyProvider(`AIza${filler(35)}`)).toBe("google");
    expect(detectKeyProvider(`sk-proj-${filler(120)}`)).toBe("openai");
    expect(detectKeyProvider(`sk-${filler(48)}`)).toBe("openai");
  });

  it("tells DeepSeek's sk- keys from OpenAI's by their shape", () => {
    expect(detectKeyProvider(`sk-${filler(32, "0123456789abcdef")}`)).toBe("deepseek");
  });

  it("reads through the whitespace and quotes a copy brings along", () => {
    expect(detectKeyProvider(`  "AIza${filler(35)}"\n`)).toBe("google");
  });

  it("says nothing rather than guessing at a key with no tell", () => {
    expect(detectKeyProvider(filler(32))).toBeNull();
    expect(detectKeyProvider("")).toBeNull();
    expect(detectKeyProvider("hello world")).toBeNull();
  });
});

describe("spotting a Gemini key on the clipboard", () => {
  it("accepts exactly the AI Studio shape", () => {
    expect(looksLikeGeminiKey(`AIza${filler(35)}`)).toBe(true);
    expect(looksLikeGeminiKey(` AIza${filler(35)} `)).toBe(true);
  });

  it("ignores anything else somebody happened to copy", () => {
    expect(looksLikeGeminiKey(`AIza${filler(20)}`)).toBe(false);
    expect(looksLikeGeminiKey(`My key is AIza${filler(35)}`)).toBe(false);
    expect(looksLikeGeminiKey("https://aistudio.google.com/apikey")).toBe(false);
  });

  it("uses Google's Flash alias, which the free tier covers", () => {
    expect(FREE_GEMINI_MODEL).toBe("gemini-flash-latest");
  });
});

describe("choosing a local model", () => {
  it("prefers a model that is good at tools and code", () => {
    expect(preferredOllamaModel(["llama2:7b", "qwen2.5-coder:7b", "mistral:latest"])).toBe("qwen2.5-coder:7b");
    expect(preferredOllamaModel(["gemma3:4b", "llama3.1:8b"])).toBe("llama3.1:8b");
  });

  it("falls back to the first model there is", () => {
    expect(preferredOllamaModel(["phi:latest", "tinyllama:latest"])).toBe("phi:latest");
    expect(preferredOllamaModel([])).toBeNull();
  });

  it("skips embedding models, which cannot chat", () => {
    expect(preferredOllamaModel(["nomic-embed-text:latest", "phi3:mini"])).toBe("phi3:mini");
  });
});
