/** The backend answer shape (hilde/schemas.py Answer), as far as the avatar view needs it. */
export interface Answer {
  question: string;
  answer: string;
  abstained: boolean;
  interpreted_as?: string | null;
  citations: { n: number; citation: string; snippet: string }[];
  seconds: number;
}
