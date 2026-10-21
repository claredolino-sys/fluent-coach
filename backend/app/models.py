from sqlalchemy import Column, Integer, String, Float, Text, DateTime, JSON
from sqlalchemy.sql import func
from .db import Base

class Assessment(Base):
    __tablename__ = "assessments"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    exercise_type = Column(String(40), nullable=False, default="baseline")
    prompt = Column(Text, nullable=False, default="")
    transcript = Column(Text, nullable=False, default="")
    duration_seconds = Column(Float, nullable=False, default=0)
    azure_pronunciation_score = Column(Float, nullable=True)
    azure_accuracy_score = Column(Float, nullable=True)
    azure_fluency_score = Column(Float, nullable=True)
    azure_prosody_score = Column(Float, nullable=True)
    speech_rate_wpm = Column(Float, nullable=True)
    filler_count = Column(Integer, nullable=False, default=0)
    pause_count = Column(Integer, nullable=True)
    pause_seconds = Column(Float, nullable=True)
    ai_feedback = Column(Text, nullable=True)
    raw_assessment = Column(JSON, nullable=True)
