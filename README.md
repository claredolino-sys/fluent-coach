# Fluent Coach

A modern React application for personal English speaking practice, speech assessment, pronunciation scoring, fluency analytics, and live AI coaching.

## Features

- **Microphone Recording & Audio Engine**: Browser-based audio recording with 16 kHz PCM WAV export and real-time RMS energy silence detection to track pauses and pause duration accurately.
- **Speaking Lab**: Multiple curated practice modes including Daily Baseline, Job Interview, Everyday Conversation, Storytelling, and Workplace English.
- **Pronunciation & Acoustic Assessment**: Measures overall pronunciation score, phoneme accuracy, fluency, prosody, speaking rate (WPM), filler word count (um, uh, like, etc.), and pause metrics.
- **Structured AI Coaching Feedback**: In-depth feedback categorized into What Worked, Clarity & Coherence, Grammar & Word Choice, Natural Professional Rephrasing, Focused Drills, and Follow-up Questions.
- **Live AI Coach**: Real-time interactive voice practice session with live conversational prompts, speech synthesis, and live transcript view.
- **Progress Tracking & Analytics**: Interactive Recharts trend visualization showing pronunciation scores over time, recent practice session history, and day-to-day score deltas.
- **Local Persistence**: Assessments and history persist across browser sessions.

## Development

```bash
npm install
npm run dev
```

The app listens on port 3000 at `http://localhost:3000`.

## Production Build

```bash
npm run build
```
