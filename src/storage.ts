import { Assessment } from './types';

const STORAGE_KEY = 'fluent_coach_assessments_v1';

const INITIAL_SESSIONS: Assessment[] = [
  {
    id: 101,
    created_at: new Date(Date.now() - 6 * 86400000).toISOString(),
    exercise_type: 'baseline',
    prompt: 'Tell me about yourself, what you have been working toward recently, and one strength you would bring to a new opportunity.',
    transcript: 'Hello, my name is Alex. Recently I have been focusing on improving my technical leadership and public speaking skills. One key strength I bring is my ability to break down complex architectural issues into straightforward, actionable steps for cross-functional teams.',
    duration_seconds: 42,
    azure_pronunciation_score: 74,
    azure_accuracy_score: 76,
    azure_fluency_score: 72,
    azure_prosody_score: 75,
    speech_rate_wpm: 122,
    filler_count: 3,
    pause_count: 5,
    pause_seconds: 6.2,
    ai_feedback: 'What worked:\n- Good initial clarity and relevant content addressing the prompt.\n\nClarity and coherence:\n- Noticeable hesitation around mid-sentence transitions.\n\nOne focused drill:\n- Practice speaking with fewer fillers.',
  },
  {
    id: 102,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    exercise_type: 'interview',
    prompt: 'Tell me about a challenge you faced and how you handled it.',
    transcript: 'A major challenge occurred when our release pipeline encountered intermittent timeout failures right before a client demonstration. I quickly assembled a small task force, isolated the network bottleneck, and rolled out a hotfix within three hours.',
    duration_seconds: 48,
    azure_pronunciation_score: 79,
    azure_accuracy_score: 81,
    azure_fluency_score: 78,
    azure_prosody_score: 77,
    speech_rate_wpm: 130,
    filler_count: 1,
    pause_count: 3,
    pause_seconds: 4.1,
    ai_feedback: 'What worked:\n- Solid structured answer following the STAR methodology.\n\nOne focused drill:\n- Emphasize key action verbs with confident vocal projection.',
  },
  {
    id: 103,
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    exercise_type: 'workplace',
    prompt: 'Imagine you need to explain a new idea to your team. Describe the idea, why it helps, and what you need from your colleagues.',
    transcript: 'I want to suggest transitioning our weekly sprint status meetings to an asynchronous dashboard update. This saves each team member approximately two hours weekly, allowing us to dedicate uninterrupted focus to deep product engineering.',
    duration_seconds: 52,
    azure_pronunciation_score: 84,
    azure_accuracy_score: 86,
    azure_fluency_score: 82,
    azure_prosody_score: 85,
    speech_rate_wpm: 138,
    filler_count: 0,
    pause_count: 2,
    pause_seconds: 2.8,
    ai_feedback: 'What worked:\n- Clear business proposal with tangible impact.\n\nOne focused drill:\n- Continue maintaining this crisp cadence across spontaneous conversations.',
  },
  {
    id: 104,
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    exercise_type: 'baseline',
    prompt: 'Tell me about yourself, what you have been working toward recently, and one strength you would bring to a new opportunity.',
    transcript: 'I am a dedicated software engineer with six years of experience building responsive, user-friendly digital tools. Over the past year, I have prioritized clear verbal communication, ensuring engineering goals align smoothly with business objectives.',
    duration_seconds: 38,
    azure_pronunciation_score: 88,
    azure_accuracy_score: 89,
    azure_fluency_score: 86,
    azure_prosody_score: 88,
    speech_rate_wpm: 142,
    filler_count: 0,
    pause_count: 1,
    pause_seconds: 1.5,
    ai_feedback: 'What worked:\n- High clarity, natural rhythm, and steady cadence.\n\nOne focused drill:\n- Keep this rhythm during high-pressure Q&A scenarios.',
  },
];

export function getStoredAssessments(): Assessment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SESSIONS));
      return INITIAL_SESSIONS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_SESSIONS;
  } catch {
    return INITIAL_SESSIONS;
  }
}

export function saveAssessment(assessment: Assessment): Assessment[] {
  const current = getStoredAssessments();
  const updated = [assessment, ...current.filter((a) => a.id !== assessment.id)];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to save to localStorage', err);
  }
  return updated;
}
