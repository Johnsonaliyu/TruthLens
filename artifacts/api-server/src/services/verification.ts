import type {
  DashboardSummary,
  ProviderHealth,
  Verification,
  VerificationSource,
  WhatsappStatus,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

type ImageInput = { data: string; mimeType: string };
type VerificationRequest = {
  content: string;
  source: "dashboard" | "whatsapp";
  image?: ImageInput;
};

const verificationHistory: Verification[] = [];
let groqVisionModelPromise: Promise<string> | undefined;
const preferredGroqVisionModel = "qwen/qwen3.8-27b";
const preferredNvidiaVisionModel = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

function hasKey(name: string) {
  return Boolean(process.env[name]);
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

async function resolveGroqVisionModel() {
  const configured = process.env.GROQ_VISION_MODEL;
  if (configured) return configured;
  return preferredGroqVisionModel;
}

async function resolveAvailableGroqVisionModel() {
  if (!groqVisionModelPromise) {
    groqVisionModelPromise = (async () => {
      try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error("Groq API key is not configured");
        const result = await fetchJson(
          "https://api.groq.com/openai/v1/models",
          {
            method: "GET",
            headers: { authorization: `Bearer ${apiKey}` },
          },
          5_000,
        );
        const modelIds = Array.isArray(result.data)
          ? result.data
              .map((model) => safeText((model as Record<string, unknown>).id))
              .filter(Boolean)
          : [];
        const visionModel = modelIds.find(
          (id) =>
            /vision|qwen/i.test(id) &&
            !/guard|safety|moderation/i.test(id),
        );
        return modelIds.includes(preferredGroqVisionModel)
          ? preferredGroqVisionModel
          : visionModel ?? preferredGroqVisionModel;
      } catch (error) {
        logger.warn({ err: error }, "Unable to resolve a Groq vision model");
        return preferredGroqVisionModel;
      }
    })();
  }
  return groqVisionModelPromise;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `${response.status} ${response.statusText}${errorBody ? `: ${errorBody.slice(0, 180)}` : ""}`,
    );
  }
  return response.json() as Promise<Record<string, unknown>>;
}

async function searchTavily(query: string): Promise<VerificationSource[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("Tavily API key is not configured");

  const result = await fetchJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
      include_raw_content: false,
    }),
  }, 10_000);

  const results = Array.isArray(result.results) ? result.results : [];
  return results.slice(0, 5).map((item) => {
    const row = item as Record<string, unknown>;
    return {
      provider: "Tavily",
      title: safeText(row.title, "Web result"),
      url: safeText(row.url) || null,
      snippet: safeText(row.content, "No summary available."),
      verdict: null,
    };
  });
}

async function searchGoogleFactCheck(query: string): Promise<VerificationSource[]> {
  const apiKey = process.env.GOOGLE_FACT_CHECK_API_KEY;
  if (!apiKey) throw new Error("Google Fact Check API key is not configured");

  const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("query", query);
  url.searchParams.set("languageCode", "en-US");
  url.searchParams.set("pageSize", "10");
  const result = await fetchJson(url.toString(), { method: "GET" }, 10_000);
  const claims = Array.isArray(result.claims) ? result.claims : [];

  return claims.flatMap((claim) => {
    const row = claim as Record<string, unknown>;
    const reviews = Array.isArray(row.claimReview) ? row.claimReview : [];
    return reviews.slice(0, 5).map((review) => {
      const item = review as Record<string, unknown>;
      return {
        provider: "Google Fact Check",
        title: safeText(item.title, safeText(row.text, "Fact-check result")),
        url: safeText(item.url) || null,
        snippet: safeText(item.textualRating, "Published fact-check"),
        verdict: safeText(item.textualRating) || null,
      };
    });
  });
}

function parseAiJson(raw: string) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI response did not contain JSON");
  return JSON.parse(match[0]) as {
    verdict?: string;
    confidence?: number;
    summary?: string;
  };
}

function normalizeVerdict(value: string | undefined): Verification["verdict"] {
  const normalized = value?.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "likely_true" || normalized === "true") return "likely_true";
  if (normalized === "likely_false" || normalized === "false") return "likely_false";
  if (normalized === "mixed") return "mixed";
  return "insufficient_evidence";
}

function researchPrompt(content: string, sources: VerificationSource[]) {
  return `You are TruthLens Naija, a careful fact-checking assistant for WhatsApp users in Nigeria.
Assess the claim below using the research results. Do not treat search ranking as proof. If evidence conflicts or is weak, choose mixed or insufficient_evidence.
Return JSON only with exactly these keys: verdict (likely_true|likely_false|mixed|insufficient_evidence), confidence (number from 0 to 1), summary (one concise explanation in plain English).

CLAIM:
${content}

RESEARCH:
${JSON.stringify(sources).slice(0, 12000)}`;
}

async function callAi(
  provider: "Groq" | "NVIDIA",
  content: string,
  sources: VerificationSource[],
  image?: ImageInput,
) {
  const isGroq = provider === "Groq";
  const apiKey = process.env[isGroq ? "GROQ_API_KEY" : "NVIDIA_API_KEY"];
  if (!apiKey) throw new Error(`${provider} API key is not configured`);

  const endpoint = isGroq
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://integrate.api.nvidia.com/v1/chat/completions";
  const model = isGroq
    ? await resolveGroqVisionModel()
    : process.env.NVIDIA_VISION_MODEL ?? preferredNvidiaVisionModel;
  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: researchPrompt(content, sources) },
  ];
  if (image) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${image.mimeType};base64,${image.data}` },
    });
  }

  const requestWithModel = (modelName: string) =>
    fetchJson(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.1,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "You are an evidence-led fact-checking analyst. Never invent sources or certainty.",
          },
          { role: "user", content: userContent },
        ],
      }),
    }, 25_000);
  let result: Record<string, unknown>;
  try {
    result = await requestWithModel(model);
  } catch (error) {
    const canUseGroqFallback =
      isGroq &&
      !process.env.GROQ_VISION_MODEL &&
      /model_not_found|does not exist|404/i.test(error instanceof Error ? error.message : "");
    if (!canUseGroqFallback) throw error;
    const fallbackModel = await resolveAvailableGroqVisionModel();
    if (fallbackModel === model) throw error;
    logger.warn({ model, fallbackModel }, "Configured Groq vision model unavailable; using accessible vision model");
    result = await requestWithModel(fallbackModel);
  }
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const message = (choices[0] as Record<string, unknown> | undefined)?.message as
    | Record<string, unknown>
    | undefined;
  const raw = safeText(message?.content);
  const parsed = parseAiJson(raw);

  return {
    verdict: normalizeVerdict(parsed.verdict),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    summary: parsed.summary?.trim() || "The available evidence is not conclusive.",
  };
}

async function extractClaimFromImage(image: ImageInput) {
  const prompt =
    "Identify the main factual claim in this image. If it is a screenshot or meme, transcribe the key claim. Return JSON only with verdict, confidence, summary.";
  try {
    return (await callAi("Groq", prompt, [], image)).summary;
  } catch (groqError) {
    logger.warn({ err: groqError }, "Groq image-to-text failed; using NVIDIA fallback");
    return (await callAi("NVIDIA", prompt, [], image)).summary;
  }
}

function fallbackAssessment(sources: VerificationSource[]) {
  const ratings = sources
    .map((source) => source.verdict?.toLowerCase() ?? "")
    .filter(Boolean)
    .join(" ");
  if (/false|pants.?on.?fire|incorrect|fake/.test(ratings)) {
    return {
      verdict: "likely_false" as const,
      confidence: 0.72,
      summary: "Published fact-check results contain ratings that challenge this claim.",
    };
  }
  if (sources.length === 0) {
    return {
      verdict: "insufficient_evidence" as const,
      confidence: 0.2,
      summary: "No matching fact-check or web evidence was found.",
    };
  }
  return {
    verdict: "insufficient_evidence" as const,
    confidence: 0.4,
    summary: "The available evidence is not strong enough to confirm or reject this claim.",
  };
}

export async function verifyClaim(request: VerificationRequest): Promise<Verification> {
  const claim = request.image
    ? await extractClaimFromImage(request.image).catch(() => request.content || "Claim shown in the image")
    : request.content;
  const [tavily, factCheck] = await Promise.allSettled([
    searchTavily(claim),
    searchGoogleFactCheck(claim),
  ]);
  const sources = [
    ...(tavily.status === "fulfilled" ? tavily.value : []),
    ...(factCheck.status === "fulfilled" ? factCheck.value : []),
  ];
  const assessment = fallbackAssessment(sources);
  let aiProvider = "fallback-rules";
  let finalAssessment: {
    verdict: Verification["verdict"];
    confidence: number;
    summary: string;
  } = assessment;

  try {
    finalAssessment = await callAi("Groq", claim, sources, request.image);
    aiProvider = "Groq vision";
  } catch (groqError) {
    logger.warn({ err: groqError }, "Groq verification failed; using NVIDIA fallback");
    try {
      finalAssessment = await callAi("NVIDIA", claim, sources, request.image);
      aiProvider = "NVIDIA vision";
    } catch (nvidiaError) {
      logger.warn({ err: nvidiaError }, "NVIDIA verification fallback failed");
    }
  }

  const result: Verification = {
    id: crypto.randomUUID(),
    content: request.content || claim,
    verdict: finalAssessment.verdict,
    confidence: Number(finalAssessment.confidence.toFixed(2)),
    summary: finalAssessment.summary,
    sources,
    aiProvider,
    createdAt: new Date().toISOString(),
    source: request.source,
  };
  verificationHistory.unshift(result);
  verificationHistory.splice(100);
  return result;
}

export function listVerifications(limit = 10) {
  return verificationHistory.slice(0, Math.min(Math.max(limit, 1), 50));
}

export function getProviderHealth(): ProviderHealth[] {
  return [
    {
      name: "Groq",
      role: "Primary vision reasoning",
      status: hasKey("GROQ_API_KEY") ? "ready" : "missing",
      detail: hasKey("GROQ_API_KEY") ? "Ready for claim analysis" : "Add GROQ_API_KEY",
    },
    {
      name: "NVIDIA",
      role: "Vision reasoning fallback",
      status: hasKey("NVIDIA_API_KEY") ? "ready" : "missing",
      detail: hasKey("NVIDIA_API_KEY") ? "Ready as fallback" : "Add NVIDIA_API_KEY",
    },
    {
      name: "Google Fact Check",
      role: "Published fact-check search",
      status: hasKey("GOOGLE_FACT_CHECK_API_KEY") ? "ready" : "missing",
      detail: hasKey("GOOGLE_FACT_CHECK_API_KEY") ? "Parallel search enabled" : "Add GOOGLE_FACT_CHECK_API_KEY",
    },
    {
      name: "Tavily",
      role: "Web evidence search",
      status: hasKey("TAVILY_API_KEY") ? "ready" : "missing",
      detail: hasKey("TAVILY_API_KEY") ? "Parallel search enabled" : "Add TAVILY_API_KEY",
    },
  ];
}

export function getSummary(whatsapp: WhatsappStatus): DashboardSummary {
  const today = new Date().toDateString();
  const todays = verificationHistory.filter(
    (item) => new Date(item.createdAt).toDateString() === today,
  );
  const flaggedToday = todays.filter((item) => item.verdict === "likely_false").length;
  const averageConfidence = verificationHistory.length
    ? verificationHistory.reduce((total, item) => total + item.confidence, 0) /
      verificationHistory.length
    : 0;
  return {
    whatsapp,
    totalVerifications: verificationHistory.length,
    verifiedToday: todays.length,
    flaggedToday,
    averageConfidence: Number(averageConfidence.toFixed(2)),
    providerHealth: getProviderHealth(),
    recent: listVerifications(5),
  };
}