import type { Answer } from "../../localjev/src/types";

// Turns one LocalJev answer into the smallest form worth recording: the verdict
// itself plus how sure the model was, so a held or approved action can be traced
// back to the classifier without replaying the prompt.
export function summarizeAnswer(answer: Answer): { value: string | number; confidence?: number } {
  switch (answer.type) {
    case "noul":
      return { value: answer.noul };
    case "choice":
      return { value: answer.choice, confidence: answer.confidence };
    case "score":
      return { value: answer.score, confidence: answer.confidence };
  }
}

export function summarizeAnswers(answers: Record<string, Answer>): Record<string, { value: string | number; confidence?: number }> {
  return Object.fromEntries(Object.entries(answers).map(([key, answer]) => [key, summarizeAnswer(answer)]));
}
