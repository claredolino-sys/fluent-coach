# Fluent Coach — full-stack MVP

A React + FastAPI English speaking practice app with real audio assessment, AI feedback, live voice conversation, and a persistent assessment history.

## What works in this scaffold

- Microphone recording in the browser; recordings are converted to mono 16 kHz PCM WAV.
- Pronunciation assessment through Microsoft Azure AI Speech, including provider-reported pronunciation, accuracy, fluency, prosody, and phoneme/word details retained in the database response.
- If the user leaves the transcript blank, the backend transcribes the recording through OpenAI before sending a reference transcript to Azure. Automatic transcription can make mistakes; the transcript can be reviewed/edited.
- AI written coaching feedback through the OpenAI Responses API. It is explicitly instructed not to infer pronunciation or pauses from transcript text.
- Live speech-to-speech practice using a short-lived Realtime client secret created by the backend. The permanent API key is never sent to the browser.
- SQLite assessment history, saved metrics, a pronunciation trend chart, and a recent-session list.
- Separate provider scores, speech rate, filler count, and approximate pauses. No invented composite score is presented as a validated measurement.

## Important limits

This is a working development scaffold, not a certified language test or production-hardened public service. Azure's pronunciation metrics are vendor-generated assessment measures, not a universal CEFR/IELTS score. To establish that the app's scores are valid for your specific accent, microphone, and speaking tasks, you would need to compare them against human-rated recordings and document that validation. The current pause counter is a lightweight signal-energy estimate, not a validated disfluency detector. The app is single-user/local by default: it does not yet have account login, cloud database migrations, consent workflows, deletion/export controls, rate limiting, or production security hardening. Add these before deploying for multiple users.

Audio/transcripts are sent to the configured OpenAI and Azure services for processing. Do not upload sensitive or confidential speech. Check each provider's current data-use, retention, regional availability, and pricing terms before use.

## Requirements

- Python 3.11+ recommended
- Node.js 20+ and npm
- OpenAI API access with billing enabled for transcription, feedback, and Realtime sessions
- Azure AI Speech resource with a key and region for pronunciation assessment
- A modern browser with microphone permissions; microphone access generally requires `localhost` or HTTPS

## 1. Configure backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell:
.venv\\Scripts\\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate
pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env`, then set:

```env
OPENAI_API_KEY=your_real_key
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_TEXT_MODEL=gpt-4.1-mini
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_SPEECH_REGION=southeastasia
DATABASE_URL=sqlite:///./fluent_coach.db
CORS_ORIGINS=http://localhost:5173
```

Set `AZURE_SPEECH_REGION` to the actual region for your Azure Speech resource. Keep `.env` private; never commit real secrets to GitHub.

Start the API:

```bash
uvicorn app.main:app --reload --port 8000
```

Check `http://localhost:8000/api/health` and API docs at `http://localhost:8000/docs`.

## 2. Start frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (normally `http://localhost:5173`). If the API is hosted elsewhere, set `VITE_API_URL` before starting/building the frontend, e.g. `VITE_API_URL=https://your-api.example.com`.

## 3. First-use flow

1. Start with **Daily baseline** and use the same prompt on later days for a more comparable trend.
2. Record in a quiet room and speak at a natural volume, with the microphone close to you.
3. Stop recording. You can optionally enter the exact words you said; leave the transcript blank to request automatic transcription.
4. Select **Assess my speech**. The app calls Azure for speech assessment, saves the returned metrics to SQLite, and requests transcript-based coaching from OpenAI.
5. Select **Live AI coach** for spontaneous speech-to-speech practice. End the live conversation before starting another session.
6. Check **Progress over time** and **Recent sessions**. Keep exercise type, prompt, microphone, and recording conditions similar when comparing results.

## API endpoints

- `GET /api/health` — service/configuration status
- `POST /api/assess` — multipart WAV audio and optional `reference_text`; returns provider scores and saves the assessment
- `POST /api/feedback` — transcript-based coaching feedback
- `POST /api/realtime/session` — creates a temporary Realtime client secret
- `GET /api/assessments?limit=60` — saved assessment history
- `GET /api/assessments/{id}` — one assessment and raw provider result

## Recommended next production steps

1. Add authentication and per-user authorization before hosting publicly.
2. Move SQLite to PostgreSQL/Cloud SQL and use migrations.
3. Add user-controlled audio retention/deletion, consent, privacy notice, and service-specific cost limits.
4. Add retries, structured provider errors, request IDs, monitoring, and secret management (for example, Google Secret Manager).
5. Create a repeatable benchmark set and compare automated scores with blinded human ratings. Do not call the app's overall results “validated” until that validation study is complete.
6. Add automated tests for audio conversion, assessment parsing, history calculations, authorization, and provider failures.
