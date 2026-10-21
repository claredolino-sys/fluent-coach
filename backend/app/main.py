import base64, json, os, re
from datetime import datetime, timedelta
from typing import Optional
import httpx
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, Depends, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import desc
from .db import Base, engine, SessionLocal
from .models import Assessment

Base.metadata.create_all(bind=engine)
app = FastAPI(title="Fluent Coach API", version="1.0.0")
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

class FeedbackRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=12000)
    prompt: str = ""
    exercise_type: str = "everyday"

class SessionRequest(BaseModel):
    exercise_type: str = "interview"

class AssessmentResponse(BaseModel):
    id: int
    created_at: Optional[datetime]
    exercise_type: str
    transcript: str
    duration_seconds: float
    azure_pronunciation_score: Optional[float]
    azure_accuracy_score: Optional[float]
    azure_fluency_score: Optional[float]
    azure_prosody_score: Optional[float]
    speech_rate_wpm: Optional[float]
    filler_count: int
    pause_count: Optional[int]
    pause_seconds: Optional[float]
    ai_feedback: Optional[str]


def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value or value.startswith("your_"):
        raise HTTPException(503, f"Server setup required: configure {name} in backend/.env")
    return value

def count_fillers(text: str) -> int:
    return len(re.findall(r"\b(um+|uh+|erm|ah+|you know|i mean|like)\b", text.lower()))

def score_value(obj, *keys):
    for key in keys:
        if isinstance(obj, dict) and key in obj and isinstance(obj[key], (int, float)):
            return float(obj[key])
    return None

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Fluent Coach API", "assessment_configured": bool(os.getenv("AZURE_SPEECH_KEY")), "realtime_configured": bool(os.getenv("OPENAI_API_KEY"))}

@app.post("/api/assess", response_model=AssessmentResponse)
async def assess_speech(
    audio: UploadFile = File(...),
    reference_text: str = Form(""),
    exercise_type: str = Form("baseline"),
    duration_seconds: float = Form(0),
    pause_count: int = Form(0),
    pause_seconds: float = Form(0),
    db: Session = Depends(get_db),
):
    """Assess a single-speaker WAV recording against the reference transcript using Azure Speech."""
    key = require_env("AZURE_SPEECH_KEY")
    region = require_env("AZURE_SPEECH_REGION")
    data = await audio.read()
    if len(data) > 20 * 1024 * 1024: raise HTTPException(413, "Audio must be 20 MB or smaller.")
    if not data: raise HTTPException(400, "Audio file is empty.")
    # If the learner did not enter a transcript, transcribe the actual recording first.
    if not reference_text.strip():
        openai_key = require_env("OPENAI_API_KEY")
        async with httpx.AsyncClient(timeout=90) as client:
            try:
                transcribe = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {openai_key}"},
                    files={"file": (audio.filename or "speech.wav", data, "audio/wav")},
                    data={"model": "gpt-4o-mini-transcribe", "language": "en"},
                )
            except httpx.HTTPError as exc:
                raise HTTPException(502, f"Transcription request failed: {exc.__class__.__name__}")
        if transcribe.status_code >= 400:
            raise HTTPException(502, f"Transcription provider returned {transcribe.status_code}; check OpenAI API access and billing.")
        reference_text = transcribe.json().get("text", "").strip()
        if not reference_text:
            raise HTTPException(422, "The recording could not be transcribed. Try speaking closer to the microphone or enter the words manually.")
    # Azure's REST pronunciation assessment endpoint expects supported audio; the frontend exports PCM WAV.
    assessment_config = {"ReferenceText": reference_text[:4000], "GradingSystem": "HundredMark", "Granularity": "Phoneme", "Dimension": "Comprehensive", "EnableMiscue": True}
    header = base64.b64encode(json.dumps(assessment_config).encode()).decode()
    url = f"https://{region}.stt.speech.microsoft.com"
    url += "/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed"
    headers = {"Ocp-Apim-Subscription-Key": key, "Pronunciation-Assessment": header, "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=90) as client:
        try:
            response = await client.post(url, headers=headers, content=data)
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"Speech assessment service request failed: {exc.__class__.__name__}")
    if response.status_code >= 400:
        raise HTTPException(502, f"Speech assessment provider returned {response.status_code}. Check Azure region, key, WAV format, and supported locale.")
    payload = response.json()
    nbest = (payload.get("NBest") or [{}])[0]
    assessment = nbest.get("PronunciationAssessment", {})
    transcript = payload.get("DisplayText") or nbest.get("Display") or reference_text
    words = len(re.findall(r"\b[\w'-]+\b", transcript))
    wpm = round(words / (duration_seconds / 60), 1) if duration_seconds > 0 else None
    row = Assessment(
        exercise_type=exercise_type[:40], prompt=reference_text[:4000], transcript=transcript[:12000], duration_seconds=max(0, duration_seconds),
        azure_pronunciation_score=score_value(assessment, "PronScore"),
        azure_accuracy_score=score_value(assessment, "AccuracyScore"),
        azure_fluency_score=score_value(assessment, "FluencyScore"),
        azure_prosody_score=score_value(assessment, "ProsodyScore"),
        speech_rate_wpm=wpm, filler_count=count_fillers(transcript), pause_count=max(0, pause_count), pause_seconds=max(0, pause_seconds), raw_assessment=payload)
    db.add(row); db.commit(); db.refresh(row)
    return row

@app.post("/api/feedback")
async def coaching_feedback(body: FeedbackRequest):
    key = require_env("OPENAI_API_KEY")
    model = os.getenv("OPENAI_TEXT_MODEL", "gpt-4.1-mini")
    system = ("You are a supportive, rigorous English fluency coach for an adult learner rebuilding advanced spoken English. "
      "Give practical feedback based only on the transcript; do not claim to hear pronunciation, accent, pauses, or stuttering from text. "
      "Use sections: What worked; Clarity and coherence; Grammar and word choice; A more natural professional version; One focused drill; Follow-up question. "
      "Preserve the speaker's meaning, avoid shaming, and do not encourage memorized scripts.")
    body_json = {"model": model, "input": [{"role":"system","content":system}, {"role":"user","content":f"Practice type: {body.exercise_type}\nPrompt: {body.prompt}\nTranscript: {body.transcript}"}]}
    async with httpx.AsyncClient(timeout=60) as client:
        try: response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {key}", "Content-Type":"application/json"}, json=body_json)
        except httpx.HTTPError as exc: raise HTTPException(502, f"AI feedback request failed: {exc.__class__.__name__}")
    if response.status_code >= 400: raise HTTPException(502, f"AI provider returned {response.status_code}; verify API access and billing.")
    result = response.json()
    text_out = "\n".join(block.get("text", "") for item in result.get("output", []) for block in item.get("content", []) if block.get("type") == "output_text")
    return {"feedback": text_out or "No feedback text returned.", "model": model}

@app.post("/api/realtime/session")
async def create_realtime_session(body: SessionRequest):
    """Create a short-lived client secret; the permanent OpenAI API key stays on the server."""
    key = require_env("OPENAI_API_KEY")
    model = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime")
    instructions = ("You are a warm but candid English speaking coach. Hold a natural spoken conversation. "
      "Ask one question at a time, wait for the learner to answer, and ask relevant follow-ups. "
      "For interview practice, act as a realistic interviewer. For everyday practice, be a natural conversation partner. "
      "Do not interrupt to correct every mistake. After several turns, briefly summarize useful language improvements. "
      "Never claim to measure phoneme accuracy; the separate assessment service does that.")
    payload = {"session": {"type": "realtime", "model": model, "instructions": instructions + f"\nPractice mode: {body.exercise_type}.", "audio": {"input": {"transcription": {"model": "gpt-4o-mini-transcribe"}}, "output": {"voice": "marin"}}}}
    async with httpx.AsyncClient(timeout=30) as client:
        try: response = await client.post("https://api.openai.com/v1/realtime/client_secrets", headers={"Authorization": f"Bearer {key}", "Content-Type":"application/json"}, json=payload)
        except httpx.HTTPError as exc: raise HTTPException(502, f"Realtime session request failed: {exc.__class__.__name__}")
    if response.status_code >= 400: raise HTTPException(502, f"Realtime provider returned {response.status_code}; verify model access and API billing.")
    return response.json()

@app.get("/api/assessments", response_model=list[AssessmentResponse])
def list_assessments(limit: int = 60, db: Session = Depends(get_db)):
    return db.query(Assessment).order_by(desc(Assessment.created_at)).limit(max(1, min(limit, 200))).all()

@app.get("/api/assessments/{assessment_id}")
def get_assessment(assessment_id: int, db: Session = Depends(get_db)):
    row = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not row: raise HTTPException(404, "Assessment not found")
    return {"assessment": row, "raw_assessment": row.raw_assessment}
