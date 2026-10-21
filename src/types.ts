export type ExerciseKey = 'baseline' | 'interview' | 'everyday' | 'storytelling' | 'workplace';

export interface ExerciseItem {
  label: string;
  title: string;
  prompt: string;
  type: ExerciseKey;
}

export interface Assessment {
  id: number;
  created_at: string;
  exercise_type: string;
  prompt: string;
  transcript: string;
  duration_seconds: number;
  azure_pronunciation_score: number | null;
  azure_accuracy_score: number | null;
  azure_fluency_score: number | null;
  azure_prosody_score: number | null;
  speech_rate_wpm: number | null;
  filler_count: number;
  pause_count: number | null;
  pause_seconds: number | null;
  ai_feedback?: string | null;
  raw_assessment?: Record<string, any> | null;
}

export interface AudioRecordingResult {
  wav: Blob;
  elapsed: number;
  pauses: {
    count: number;
    seconds: number;
    quietStart: number | null;
  };
}
