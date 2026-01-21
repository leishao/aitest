import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { YoutubeTranscript } from "youtube-transcript";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const MAX_TRANSCRIPT_CHARS = 12000;
const STYLE_LIMIT = 240;
const DETAIL_LIMIT = 500;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/generate", async (req, res) => {
  const { url, stylePreset, styleDetail, length, language } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Please provide a YouTube URL." });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res
      .status(400)
      .json({ error: "Unable to parse the YouTube video ID." });
  }

  let segments;
  try {
    segments = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (error) {
    console.error("Transcript fetch failed:", error);
    return res.status(502).json({
      error:
        "Failed to fetch the transcript. Check if captions are available.",
    });
  }

  if (!segments || segments.length === 0) {
    return res
      .status(404)
      .json({ error: "No transcript found for this video." });
  }

  const transcriptText = normalizeTranscript(segments);
  const truncated = transcriptText.length > MAX_TRANSCRIPT_CHARS;
  const transcript = truncated
    ? `${transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)} ...`
    : transcriptText;

  try {
    const { text, mode } = await generateArticle({
      transcript,
      segments,
      stylePreset,
      styleDetail,
      length,
      language,
      truncated,
    });

    return res.json({
      videoId,
      transcript,
      truncated,
      article: text,
      mode,
    });
  } catch (error) {
    console.error("Article generation failed:", error);
    return res.status(500).json({ error: "Failed to generate article." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

function extractVideoId(input) {
  const trimmed = input.trim();

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace("www.", "");

    if (host === "youtu.be") {
      return parsed.pathname.replace(/\//g, "");
    }

    if (host.endsWith("youtube.com")) {
      const idFromQuery = parsed.searchParams.get("v");
      if (idFromQuery) {
        return idFromQuery;
      }

      const pathMatch = parsed.pathname.match(
        /\/(shorts|live|embed)\/([^/?]+)/,
      );
      if (pathMatch) {
        return pathMatch[2];
      }
    }
  } catch (error) {
    // Ignore URL parsing errors and try fallback matching.
  }

  const fallbackMatch = trimmed.match(
    /(?:v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([a-zA-Z0-9_-]{6,})/,
  );

  return fallbackMatch ? fallbackMatch[1] : null;
}

function normalizeTranscript(segments) {
  return segments
    .map((segment) => segment.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampText(value, maxLength) {
  if (!value) {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildStyleDescriptor(stylePreset, styleDetail, language) {
  const safePreset = clampText(stylePreset, STYLE_LIMIT);
  const safeDetail = clampText(styleDetail, DETAIL_LIMIT);
  const safeLanguage = clampText(language, 40);

  const parts = [];
  if (safePreset) {
    parts.push(safePreset);
  }
  if (safeDetail) {
    parts.push(safeDetail);
  }
  if (safeLanguage && safeLanguage !== "auto") {
    parts.push(`Output language: ${safeLanguage}`);
  }

  return parts.join(" | ");
}

function lengthSpecFromChoice(choice) {
  const normalized = String(choice || "").toLowerCase();
  const lengthMap = {
    short: "300-450 words",
    medium: "600-900 words",
    long: "1000-1400 words",
  };

  return lengthMap[normalized] || lengthMap.medium;
}

async function generateArticle({
  transcript,
  segments,
  stylePreset,
  styleDetail,
  length,
  language,
  truncated,
}) {
  const styleDescriptor = buildStyleDescriptor(
    stylePreset,
    styleDetail,
    language,
  );
  const lengthSpec = lengthSpecFromChoice(length);

  if (process.env.OPENAI_API_KEY) {
    try {
      const text = await generateWithOpenAI({
        transcript,
        styleDescriptor,
        lengthSpec,
        truncated,
      });
      if (text) {
        return { text, mode: "openai" };
      }
    } catch (error) {
      console.error("OpenAI generation failed:", error);
    }
  }

  return {
    text: ruleBasedArticle({
      segments,
      styleDescriptor,
      lengthSpec,
      truncated,
    }),
    mode: "fallback",
  };
}

async function generateWithOpenAI({
  transcript,
  styleDescriptor,
  lengthSpec,
  truncated,
}) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const systemPrompt =
    "You turn podcast transcripts into structured articles. " +
    "Do not invent details that are not in the transcript.";

  const styleLine = styleDescriptor
    ? `Style notes: ${styleDescriptor}.`
    : "Style notes: neutral professional tone.";
  const transcriptLine = truncated
    ? "Transcript (truncated for length):"
    : "Transcript:";

  const userPrompt = [
    `${styleLine}`,
    `Target length: ${lengthSpec}.`,
    "Provide a title, section headings, and a short key points list.",
    `${transcriptLine}`,
    transcript,
  ].join("\n\n");

  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_output_tokens: 1200,
    temperature: 0.5,
  });

  return (response.output_text || "").trim();
}

function ruleBasedArticle({
  segments,
  styleDescriptor,
  lengthSpec,
  truncated,
}) {
  const title = buildTitle(segments);
  const intro = segmentsToText(segments.slice(0, 6));
  const closing = segmentsToText(segments.slice(-6));
  const points = samplePoints(segments, 5);

  const styleLine = styleDescriptor
    ? `Style focus: ${styleDescriptor}.`
    : "Style focus: neutral summary.";
  const scopeLine = truncated
    ? "Note: transcript truncated to fit context."
    : "Note: transcript fully included for this summary.";

  return [
    `# ${title}`,
    "",
    "## Overview",
    `${styleLine} ${intro}`,
    "",
    `Target length: ${lengthSpec}.`,
    "",
    "## Key Points",
    points.map((point) => `- ${point}`).join("\n"),
    "",
    "## Closing",
    closing || "The discussion concludes with a wrap-up of key takeaways.",
    "",
    "## Source Notes",
    `${scopeLine} This article is generated from the transcript and may omit details.`,
  ].join("\n");
}

function buildTitle(segments) {
  const seed =
    segments.find((segment) => segment.text && segment.text.length > 5)?.text ||
    "Podcast Summary";
  const cleaned = seed.replace(/\s+/g, " ").trim();

  if (!cleaned) {
    return "Podcast Summary";
  }

  return cleaned.length > 70 ? `${cleaned.slice(0, 70).trim()}...` : cleaned;
}

function segmentsToText(segments) {
  return segments
    .map((segment) => segment.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function samplePoints(segments, count) {
  if (!segments.length) {
    return [];
  }

  const points = [];
  const step = Math.max(1, Math.floor(segments.length / count));

  for (let i = 0; i < segments.length && points.length < count; i += step) {
    const chunk = segmentsToText(segments.slice(i, i + 3));
    if (chunk) {
      points.push(chunk);
    }
  }

  return points;
}
