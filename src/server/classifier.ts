import { GoogleGenAI, Type } from '@google/genai';
import type {
  ComplaintCategory,
  ComplaintLanguage,
  ComplaintPriority,
  SlaTier,
} from '../types/domain.ts';

export interface ClassificationResult {
  category_code: string;
  category_id: string;
  department_id: string;
  confidence: number;
  priority: ComplaintPriority;
  sla_tier: SlaTier;
  reason_code: string;
  detected_language: ComplaintLanguage;
  raw_reasoning: string;
  model_version: string;
  raw_model_response: string;
}

const BANGLISH_MARKERS = [
  'rasta',
  'pani',
  'biddut',
  'moyla',
  'nai',
  'ache',
  'korse',
  'korte',
  'hocche',
  'geche',
  'amar',
  'amader',
  'taka',
  'ghush',
  'dokhol',
  'vanga',
  'gorto',
  'chintai',
  'mosha',
  'dorkar',
  'janjot',
  'ekhon',
  'khub',
  'din',
  'dhore',
  'ashe',
  'khola',
  'bati',
  'nosto',
  'oshudh',
];

export function detectLanguageHeuristic(text: string): ComplaintLanguage {
  if (/[\u0980-\u09FF]/.test(text)) {
    return 'bn';
  }
  const lower = text.toLowerCase();
  const banglishHits = BANGLISH_MARKERS.filter((token) =>
    new RegExp(`\\b${token}\\b`, 'i').test(lower)
  ).length;
  if (banglishHits >= 2) {
    return 'banglish';
  }
  return 'en';
}

function tierToPriority(tier: SlaTier): ComplaintPriority {
  if (tier === 'CRITICAL') return 'CRITICAL';
  if (tier === 'STANDARD') return 'MEDIUM';
  if (tier === 'COMPLEX') return 'HIGH';
  return 'LOW';
}

/**
 * Deterministic Bangla + English + Banglish keyword/regex fallback classifier.
 * Works completely offline with zero external API keys.
 */
export function classifyWithKeywordFallback(
  rawText: string,
  categories: ComplaintCategory[],
  modelTag = 'keyword-rule-fallback-v1'
): ClassificationResult {
  const lower = rawText.toLowerCase();
  const detectedLanguage = detectLanguageHeuristic(rawText);

  const scored = categories.map((cat) => {
    const matchedTerms: string[] = [];
    let score = 0;

    for (const kw of cat.keywordsEn) {
      if (lower.includes(kw.toLowerCase())) {
        score += kw.includes(' ') ? 2.4 : 1.6;
        matchedTerms.push(kw);
      }
    }
    for (const kw of cat.keywordsBn) {
      if (rawText.includes(kw)) {
        score += 2.0;
        matchedTerms.push(kw);
      }
    }
    for (const kw of cat.keywordsBanglish) {
      if (lower.includes(kw.toLowerCase())) {
        score += 1.8;
        matchedTerms.push(kw);
      }
    }

    return { cat, score, matchedTerms };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const runnerUp = scored[1];

  if (!top || top.score === 0) {
    const fallbackCat = categories[0];
    const reasoning =
      'Fallback keyword matcher found zero strong domain tokens across Bangla, English, and Banglish dictionaries. Flagged for human triage officer review.';
    return {
      category_code: fallbackCat.code,
      category_id: fallbackCat.id,
      department_id: fallbackCat.departmentId,
      confidence: 0.42,
      priority: tierToPriority(fallbackCat.slaTier),
      sla_tier: fallbackCat.slaTier,
      reason_code: 'NO_KEYWORD_MATCH_AMBIGUOUS',
      detected_language: detectedLanguage,
      raw_reasoning: reasoning,
      model_version: modelTag,
      raw_model_response: JSON.stringify({
        engine: modelTag,
        top_score: 0,
        matched_terms: [],
        reasoning,
      }),
    };
  }

  const margin = runnerUp ? top.score - runnerUp.score : top.score;
  let confidence = 0.56 + Math.min(0.28, top.score * 0.065) + Math.min(0.12, margin * 0.045);
  // If runner-up is very close and score is modest, keep confidence < 0.70 so triage catches ambiguity
  if (runnerUp && runnerUp.score > 0 && margin < 1.0 && top.score < 3.6) {
    confidence = Math.min(confidence, 0.64);
  }
  confidence = Number(Math.min(0.97, Math.max(0.42, confidence)).toFixed(2));

  const reasonCode =
    confidence < 0.7 ? `AMBIGUOUS_${top.cat.code}` : `KEYWORD_MATCH_${top.cat.code}`;
  const reasoning =
    confidence < 0.7
      ? `Low-confidence heuristic match (${Math.round(confidence * 100)}%). Top candidate ${top.cat.code} matched [${top.matchedTerms.join(', ')}] (score ${top.score.toFixed(1)}), closely competing with ${runnerUp?.cat.code || 'none'} (score ${runnerUp?.score.toFixed(1) || '0'}). Routed to triage_officer queue.`
      : `Matched ${top.cat.code} (${top.cat.nameEn}) via terms [${top.matchedTerms.join(', ')}] with score ${top.score.toFixed(1)} over runner-up ${runnerUp?.cat.code || 'none'} (${runnerUp?.score.toFixed(1) || '0'}).`;

  return {
    category_code: top.cat.code,
    category_id: top.cat.id,
    department_id: top.cat.departmentId,
    confidence,
    priority: tierToPriority(top.cat.slaTier),
    sla_tier: top.cat.slaTier,
    reason_code: reasonCode,
    detected_language: detectedLanguage,
    raw_reasoning: reasoning,
    model_version: modelTag,
    raw_model_response: JSON.stringify({
      engine: modelTag,
      top_candidate: top.cat.code,
      top_score: Number(top.score.toFixed(2)),
      runner_up: runnerUp?.cat.code || null,
      runner_up_score: runnerUp ? Number(runnerUp.score.toFixed(2)) : 0,
      matched_terms: top.matchedTerms,
      reasoning,
    }),
  };
}

let cachedAiClient: GoogleGenAI | null | undefined;

function getGeminiClient(): GoogleGenAI | null {
  if (cachedAiClient !== undefined) return cachedAiClient;
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') {
    cachedAiClient = null;
    return null;
  }
  cachedAiClient = new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return cachedAiClient;
}

export async function classifyComplaint(params: {
  rawText: string;
  categories: ComplaintCategory[];
  imageBase64?: string;
  imageMimeType?: string;
  voiceNoteTranscript?: string;
}): Promise<ClassificationResult> {
  const { rawText, categories, imageBase64, imageMimeType, voiceNoteTranscript } = params;
  const combinedText = voiceNoteTranscript?.trim()
    ? `${rawText}\n[Voice note transcript]: ${voiceNoteTranscript.trim()}`
    : rawText;

  const ai = getGeminiClient();
  if (!ai) {
    return classifyWithKeywordFallback(combinedText, categories, 'keyword-rule-fallback-v1');
  }

  const catalogSummary = categories
    .map(
      (c) =>
        `- ${c.code} | dept: ${c.departmentId} | tier: ${c.slaTier} | EN: ${c.nameEn} | BN: ${c.nameBn}`
    )
    .join('\n');

  const promptText = `You are the official Bangladesh Government Civic Grievance AI Router.
Classify the following citizen complaint (written in Bangla, English, or Banglish) into EXACTLY ONE category from the catalog below.

CATALOG:
${catalogSummary}

COMPLAINT TEXT:
"""
${combinedText}
"""

RULES:
1. Return STRICT JSON only matching the schema.
2. If the complaint is vague, spans multiple unrelated departments equally, or lacks enough detail to pick a category with certainty, set confidence below 0.70 (e.g., 0.45-0.65) and explain the ambiguity clearly in raw_reasoning.
3. detected_language must be "bn" (Bangla script), "banglish" (Bengali written in Latin script), or "en" (English).
4. priority must be one of CRITICAL, HIGH, MEDIUM, LOW.`;

  try {
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: promptText },
    ];
    if (imageBase64 && imageMimeType) {
      const stripped = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      parts.unshift({
        inlineData: {
          mimeType: imageMimeType,
          data: stripped,
        },
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        systemInstruction:
          'Return strict JSON classification for Bangladesh civic complaints. Never invent category codes outside the catalog.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category_code: { type: Type.STRING },
            department_id: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            priority: { type: Type.STRING },
            sla_tier: { type: Type.STRING },
            reason_code: { type: Type.STRING },
            detected_language: { type: Type.STRING },
            raw_reasoning: { type: Type.STRING },
          },
          required: [
            'category_code',
            'department_id',
            'confidence',
            'priority',
            'sla_tier',
            'reason_code',
            'detected_language',
            'raw_reasoning',
          ],
        },
      },
    });

    const rawTextResp = (response.text ?? '').trim();
    const parsed = JSON.parse(rawTextResp) as {
      category_code: string;
      department_id: string;
      confidence: number;
      priority: string;
      sla_tier: string;
      reason_code: string;
      detected_language: string;
      raw_reasoning: string;
    };

    const matchedCat = categories.find((c) => c.code === parsed.category_code);
    if (!matchedCat) {
      return classifyWithKeywordFallback(combinedText, categories, 'keyword-fallback-invalid-llm-code');
    }

    const clampedConf = Number(Math.min(0.99, Math.max(0.1, Number(parsed.confidence) || 0.5)).toFixed(2));
    const validPriority: ComplaintPriority = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(
      parsed.priority
    )
      ? parsed.priority
      : tierToPriority(matchedCat.slaTier)) as ComplaintPriority;
    const validLang: ComplaintLanguage = (['bn', 'en', 'banglish'].includes(
      parsed.detected_language
    )
      ? parsed.detected_language
      : detectLanguageHeuristic(combinedText)) as ComplaintLanguage;

    return {
      category_code: matchedCat.code,
      category_id: matchedCat.id,
      department_id: matchedCat.departmentId,
      confidence: clampedConf,
      priority: validPriority,
      sla_tier: matchedCat.slaTier,
      reason_code: parsed.reason_code || `LLM_${matchedCat.code}`,
      detected_language: validLang,
      raw_reasoning: parsed.raw_reasoning || 'Classified by Gemini AI routing engine.',
      model_version: 'gemini-4-hydrogen',
      raw_model_response: rawTextResp,
    };
  } catch (err) {
    console.warn('Gemini classification failed, falling back to offline keyword engine:', err);
    const fallback = classifyWithKeywordFallback(
      combinedText,
      categories,
      'keyword-rule-fallback-on-error'
    );
    // If LLM itself errored and fallback confidence is borderline, preserve transparency
    return {
      ...fallback,
      raw_reasoning: `${fallback.raw_reasoning} (LLM fallback invoked after upstream error.)`,
    };
  }
}
