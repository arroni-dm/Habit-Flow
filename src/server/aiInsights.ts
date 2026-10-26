import { GoogleGenAI, Type } from '@google/genai';

export function isAiInsightsEnabled(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY' || key.length < 10) {
    return false;
  }
  return true;
}

export interface AiHabitInsightInput {
  periodLabel: string;
  overallCompletionRate: number;
  completedOccurrences: number;
  eligibleOccurrences: number;
  currentStreak: number;
  longestStreak: number;
  topHabits: { name: string; completionRate: number; completed: number; eligible: number }[];
  attentionHabits: { name: string; completionRate: number; missed: number; eligible: number }[];
}

export interface AiHabitInsightOutput {
  summary: string;
  consistencyObservations: string[];
  suggestedAdjustments: string[];
  weeklyReflection: string;
  disclaimer: string;
}

export async function generateHabitAiInsights(
  payload: AiHabitInsightInput
): Promise<AiHabitInsightOutput> {
  if (!isAiInsightsEnabled()) {
    throw new Error('AI Insights are disabled because GEMINI_API_KEY is not configured on the server.');
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const prompt = `Analyze the following verified habit tracking statistics for ${payload.periodLabel}.
Use ONLY the numbers provided below. Do NOT invent any statistics, dates, or medical claims.
Provide calm, practical, nonjudgmental recommendations.

Verified Metrics:
- Overall completion rate: ${payload.overallCompletionRate}% (${payload.completedOccurrences} of ${payload.eligibleOccurrences} scheduled occurrences)
- Current consistency streak: ${payload.currentStreak} day(s) (Longest: ${payload.longestStreak} day(s))
- Strongest habits: ${
    payload.topHabits.length > 0
      ? payload.topHabits.map((h) => `${h.name} (${h.completionRate}%, ${h.completed}/${h.eligible})`).join('; ')
      : 'None recorded yet'
  }
- Habits needing schedule or target review: ${
    payload.attentionHabits.length > 0
      ? payload.attentionHabits.map((h) => `${h.name} (${h.completionRate}%, ${h.missed} missed of ${h.eligible})`).join('; ')
      : 'None'
  }`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: prompt,
    config: {
      systemInstruction:
        'You are a pragmatic productivity analyst inside HabitFlow. Summarize only verified user habit metrics, highlight consistency patterns, and offer 2-3 realistic schedule or target adjustments without judgment or medical advice. Keep responses concise.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: '2-3 sentence summary of recent consistency grounded strictly in the provided numbers.',
          },
          consistencyObservations: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '2-3 specific observations about consistency trends.',
          },
          suggestedAdjustments: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '2-3 optional, practical adjustments to habit schedules, deadlines, or targets.',
          },
          weeklyReflection: {
            type: Type.STRING,
            description: 'A calm 2-sentence reflection prompt for the upcoming week.',
          },
        },
        required: [
          'summary',
          'consistencyObservations',
          'suggestedAdjustments',
          'weeklyReflection',
        ],
      },
    },
  });

  const rawText = response.text?.trim() || '{}';
  const parsed = JSON.parse(rawText);

  return {
    summary: String(parsed.summary || 'Consistency metrics analyzed.'),
    consistencyObservations: Array.isArray(parsed.consistencyObservations)
      ? parsed.consistencyObservations.map(String).slice(0, 4)
      : [],
    suggestedAdjustments: Array.isArray(parsed.suggestedAdjustments)
      ? parsed.suggestedAdjustments.map(String).slice(0, 4)
      : [],
    weeklyReflection: String(parsed.weeklyReflection || ''),
    disclaimer:
      'Optional AI-generated suggestions based on aggregated metrics. Not medical or clinical advice.',
  };
}
