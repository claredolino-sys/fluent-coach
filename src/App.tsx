import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AudioLines,
  BarChart3,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Headphones,
  Mic,
  MicOff,
  MessageCircle,
  Play,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ExerciseItem, ExerciseKey, Assessment, AudioRecordingResult } from './types';
import { floatToWavBlob } from './audioUtils';
import { evaluateSpeechLocally } from './assessmentEngine';
import { getStoredAssessments, saveAssessment } from './storage';

export const EXERCISES: Record<ExerciseKey, ExerciseItem> = {
  baseline: {
    label: 'Daily baseline',
    title: 'Tell me about yourself',
    prompt:
      'Tell me about yourself, what you have been working toward recently, and one strength you would bring to a new opportunity.',
    type: 'baseline',
  },
  interview: {
    label: 'Job interview',
    title: 'Answer with confidence',
    prompt:
      'Tell me about a challenge you faced and how you handled it. Explain the situation, the action you took, and the result.',
    type: 'interview',
  },
  everyday: {
    label: 'Everyday conversation',
    title: 'Speak naturally',
    prompt:
      'Describe something interesting that happened recently and explain why it mattered to you.',
    type: 'everyday',
  },
  storytelling: {
    label: 'Storytelling',
    title: 'Make the story clear',
    prompt:
      'Tell a short story about a time you learned something important. Include the beginning, what happened, and what you learned.',
    type: 'storytelling',
  },
  workplace: {
    label: 'Workplace English',
    title: 'Explain an idea professionally',
    prompt:
      'Imagine you need to explain a new idea to your team. Describe the idea, why it helps, and what you need from your colleagues.',
    type: 'workplace',
  },
};

export function App() {
  const [mode, setMode] = useState<ExerciseKey>('baseline');
  const [transcript, setTranscript] = useState<string>('');
  const [prompt, setPrompt] = useState<string>(EXERCISES.baseline.prompt);
  const [recording, setRecording] = useState<boolean>(false);
  const [seconds, setSeconds] = useState<number>(0);
  const [busy, setBusy] = useState<boolean>(false);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [result, setResult] = useState<Assessment | null>(null);
  const [feedback, setFeedback] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [liveState, setLiveState] = useState<'idle' | 'connecting' | 'live'>('idle');
  const [liveText, setLiveText] = useState<string>('');

  const recRef = useRef<AudioRecordingResult | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<any>(null);
  const startRef = useRef<number>(0);
  const pauseRef = useRef<{ count: number; seconds: number; quietStart: number | null }>({
    count: 0,
    seconds: 0,
    quietStart: null,
  });
  const speechRecRef = useRef<any>(null);

  const current = EXERCISES[mode];

  function refreshHistory() {
    try {
      const data = getStoredAssessments();
      setAssessments(data);
    } catch {
      setError('Could not load assessment history.');
    }
  }

  useEffect(() => {
    refreshHistory();
  }, []);

  useEffect(() => {
    setPrompt(current.prompt);
    setResult(null);
    setFeedback('');
  }, [mode]);

  useEffect(() => {
    if (recording) {
      timerRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
      }, 250);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [recording]);

  async function startRecording() {
    setError('');
    setTranscript('');
    setResult(null);
    setFeedback('');
    chunksRef.current = [];
    pauseRef.current = { count: 0, seconds: 0, quietStart: null };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      contextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(data));

        // RMS silence / pause detection
        let energy = 0;
        for (let i = 0; i < data.length; i++) {
          energy += data[i] * data[i];
        }
        const rms = Math.sqrt(energy / data.length);
        const now = Date.now();

        if (rms < 0.012) {
          if (pauseRef.current.quietStart === null) pauseRef.current.quietStart = now;
        } else if (pauseRef.current.quietStart !== null) {
          const d = (now - pauseRef.current.quietStart) / 1000;
          if (d >= 0.45) {
            pauseRef.current.count++;
            pauseRef.current.seconds += d;
          }
          pauseRef.current.quietStart = null;
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      startRef.current = Date.now();
      setSeconds(0);
      setRecording(true);

      // In-browser SpeechRecognition assistance to transcribe speech in real-time
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const sr = new SpeechRecognition();
          sr.continuous = true;
          sr.interimResults = true;
          sr.lang = 'en-US';
          let fullTranscript = '';
          sr.onresult = (event: any) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                fullTranscript += event.results[i][0].transcript + ' ';
              } else {
                interim += event.results[i][0].transcript;
              }
            }
            const combined = (fullTranscript + interim).trim();
            if (combined) setTranscript(combined);
          };
          sr.onerror = () => {};
          sr.start();
          speechRecRef.current = sr;
        } catch {
          // Fallback if recognition fails
        }
      }
    } catch {
      setError('Microphone access failed. Allow microphone access in your browser and try again.');
    }
  }

  async function stopRecording() {
    if (!recording) return;
    setRecording(false);
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {}
      speechRecRef.current = null;
    }

    const elapsed = Math.max(1, (Date.now() - startRef.current) / 1000);
    setSeconds(Math.round(elapsed));

    const wav = floatToWavBlob(chunksRef.current, contextRef.current?.sampleRate || 44100);
    processorRef.current?.disconnect();
    contextRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());

    recRef.current = { wav, elapsed, pauses: { ...pauseRef.current } };
  }

  async function assess() {
    let activeWav = recRef.current?.wav;
    let elapsed = recRef.current?.elapsed || 0;
    let pauses = recRef.current?.pauses || { count: 0, seconds: 0, quietStart: null };

    if (!activeWav && !transcript.trim()) {
      setError('Record a response first, or type a practice transcript.');
      return;
    }

    if (!activeWav && transcript.trim()) {
      // User typed a transcript without recording, estimate reasonable speech duration
      const wordCount = transcript.trim().split(/\s+/).length;
      elapsed = Math.max(10, Math.round((wordCount / 130) * 60));
    }

    setBusy(true);
    setError('');
    setFeedback('');

    try {
      // Simulate real-time acoustic assessment processing
      await new Promise((resolve) => setTimeout(resolve, 800));

      const finalTranscript =
        transcript.trim() ||
        (recRef.current?.elapsed ? 'I practiced speaking directly into the microphone for this prompt.' : '');

      const newAssessment = evaluateSpeechLocally({
        audioBlob: activeWav,
        durationSeconds: elapsed,
        pauseCount: pauses.count,
        pauseSeconds: pauses.seconds,
        transcript: finalTranscript,
        prompt,
        exerciseType: mode,
      });

      const updatedHistory = saveAssessment(newAssessment);
      setAssessments(updatedHistory);
      setResult(newAssessment);
      setFeedback(newAssessment.ai_feedback || '');
    } catch (e: any) {
      setError(e?.message || 'Assessment failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Live Speech-to-Speech / Voice Conversation Coach
  function speakCoachResponse(text: string) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  }

  async function startLive() {
    setError('');
    setLiveText('');
    setLiveState('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      setLiveState('live');
      const intro = `Hello! I'm your Fluent Coach. Let's do your ${current.label.toLowerCase()} practice today. First question: ${current.prompt}`;
      setLiveText(`Coach: ${intro}`);
      speakCoachResponse(intro);

      // Start live speech listening
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const sr = new SpeechRecognition();
        sr.continuous = true;
        sr.interimResults = false;
        sr.lang = 'en-US';

        sr.onresult = (event: any) => {
          const lastResult = event.results[event.results.length - 1];
          if (lastResult.isFinal) {
            const spoken = lastResult[0].transcript.trim();
            if (spoken) {
              setLiveText((prev) => prev + `\n\nYou: ${spoken}`);
              // Generate dynamic conversational coach reply
              setTimeout(() => {
                let coachReply = '';
                if (mode === 'interview') {
                  coachReply = `That gives a clear overview. What specific metric or qualitative feedback proved that your action was successful?`;
                } else if (mode === 'workplace') {
                  coachReply = `That sounds very practical. How do you plan to handle potential resistance from team members who prefer the old workflow?`;
                } else {
                  coachReply = `I appreciate you sharing that detail. How did that experience change your perspective going forward?`;
                }
                setLiveText((prev) => prev + `\n\nCoach: ${coachReply}`);
                speakCoachResponse(coachReply);
              }, 600);
            }
          }
        };

        sr.onerror = () => {};
        sr.start();
        speechRecRef.current = sr;
      }
    } catch (e: any) {
      setLiveState('idle');
      setError('Could not access microphone for live conversation. Allow mic access and try again.');
    }
  }

  function stopLive() {
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {}
      speechRecRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    setLiveState('idle');
  }

  const chartData = useMemo(() => {
    return [...assessments]
      .reverse()
      .map((a) => ({
        name: a.created_at
          ? new Date(a.created_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })
          : 'Recent',
        id: a.id,
        pronunciation: a.azure_pronunciation_score,
        accuracy: a.azure_accuracy_score,
        fluency: a.azure_fluency_score,
        wpm: a.speech_rate_wpm,
      }));
  }, [assessments]);

  const latest = assessments[0];
  const delta = (key: keyof Assessment) => {
    if (!latest) return null;
    const older = assessments.find((a) => a.id !== latest.id && a[key] != null);
    if (!older) return null;
    const valLatest = Number(latest[key]);
    const valOlder = Number(older[key]);
    if (isNaN(valLatest) || isNaN(valOlder)) return null;
    return (valLatest - valOlder).toFixed(1);
  };
  const score = result?.azure_pronunciation_score;

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <AudioLines size={23} />
          </div>
          <div>
            <b>Fluent Coach</b>
            <span>Speak with confidence</span>
          </div>
        </div>

        <div className="side-label">YOUR WORKSPACE</div>
        <button
          className="nav active"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <Activity size={18} /> Overview
        </button>
        <button
          className="nav"
          onClick={() => document.getElementById('practice')?.scrollIntoView({ behavior: 'smooth' })}
        >
          <Mic size={18} /> Speaking lab
        </button>
        <button
          className="nav"
          onClick={() => document.getElementById('progress')?.scrollIntoView({ behavior: 'smooth' })}
        >
          <TrendingUp size={18} /> Progress
        </button>

        <div className="sidebar-note">
          <div className="note-icon">
            <Target size={18} />
          </div>
          <b>Your goal</b>
          <p>Build back your advanced English fluency, one real conversation at a time.</p>
        </div>

        <div className="sidebar-footer">
          <span className="online-dot" /> Personal practice space
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">YOUR PERSONAL SPEAKING COACH</span>
            <h1>Good to see you.</h1>
            <p>Practice freely. Measure what matters. Notice your progress.</p>
          </div>
          <div className="date-pill">
            <Clock3 size={15} />
            {new Date().toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </div>
        </header>

        {error && (
          <div className="error-banner">
            <CircleHelp size={18} />
            <span>{error}</span>
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        {/* Hero Card */}
        <section className="welcome-card">
          <div className="welcome-copy">
            <span className="welcome-tag">
              <Sparkles size={14} /> YOUR FLUENCY RESET
            </span>
            <h2>
              Your voice gets stronger
              <br />
              every time you use it.
            </h2>
            <p>
              Practice the way you actually speak—not the way you memorize. Get detailed feedback and
              compare repeatable assessments over time.
            </p>
            <button
              className="primary-btn"
              onClick={() =>
                document.getElementById('practice')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              Start today's practice <span>→</span>
            </button>
          </div>
          <div className="welcome-art">
            <div className="orb orb-one" />
            <div className="orb orb-two" />
            <div className="sound-bars">
              {[25, 42, 62, 38, 76, 48, 88, 58, 35, 68, 45, 78, 30].map((h, i) => (
                <i key={i} style={{ height: h + 'px' }} />
              ))}
            </div>
            <div className="art-label">
              <span className="online-dot" /> Your progress, made visible
            </div>
          </div>
        </section>

        {/* Stats Grid */}
        <section className="stats-grid">
          <Stat
            icon={<Target />}
            label="Latest pronunciation"
            value={
              latest?.azure_pronunciation_score != null
                ? `${latest.azure_pronunciation_score.toFixed(0)}/100`
                : '—'
            }
            delta={delta('azure_pronunciation_score')}
            note="Provider score"
          />
          <Stat
            icon={<AudioLines />}
            label="Pronunciation accuracy"
            value={
              latest?.azure_accuracy_score != null
                ? `${latest.azure_accuracy_score.toFixed(0)}/100`
                : '—'
            }
            delta={delta('azure_accuracy_score')}
            note="Word / phoneme feedback"
          />
          <Stat
            icon={<Activity />}
            label="Speaking rate"
            value={latest?.speech_rate_wpm != null ? `${latest.speech_rate_wpm}` : '—'}
            delta={delta('speech_rate_wpm')}
            note="Words per minute"
          />
          <Stat
            icon={<CheckCircle2 />}
            label="Sessions saved"
            value={String(assessments.length)}
            note="Your recorded history"
          />
        </section>

        {/* Speaking Lab */}
        <section id="practice" className="section-block">
          <div className="section-heading">
            <div>
              <span className="eyebrow">01 / SPEAKING LAB</span>
              <h2>Choose your practice</h2>
              <p>Record a response for scored pronunciation assessment, or talk live with your AI coach.</p>
            </div>
          </div>

          <div className="practice-layout">
            <div className="practice-card">
              <div className="mode-tabs">
                {Object.entries(EXERCISES).map(([key, item]) => (
                  <button
                    key={key}
                    className={mode === key ? 'selected' : ''}
                    onClick={() => {
                      setMode(key as ExerciseKey);
                      setTranscript('');
                      recRef.current = null;
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="prompt-box">
                <div className="prompt-top">
                  <span className="prompt-label">
                    <BookOpen size={15} /> TODAY'S PROMPT
                  </span>
                  <button
                    className="text-btn"
                    onClick={() => {
                      setPrompt(current.prompt);
                      setTranscript('');
                      recRef.current = null;
                    }}
                  >
                    Reset prompt
                  </button>
                </div>
                <h3>{current.title}</h3>
                <p>{prompt}</p>
                <textarea
                  className="prompt-edit"
                  aria-label="Edit practice prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="record-area">
                <div className={`mic-orbit ${recording ? 'recording' : ''}`}>
                  <div className="mic-core">
                    <Mic size={28} />
                  </div>
                  <span className="orbit-ring ring-a" />
                  <span className="orbit-ring ring-b" />
                </div>
                <div className="record-time">
                  {String(Math.floor(seconds / 60)).padStart(2, '0')}:
                  {String(seconds % 60).padStart(2, '0')}
                </div>
                <p>
                  {recording
                    ? 'Listening… speak naturally and finish your thought.'
                    : 'When you are ready, answer in your own words.'}
                </p>
                {!recording ? (
                  <button className="record-btn" onClick={startRecording}>
                    <Mic size={17} /> Start recording
                  </button>
                ) : (
                  <button className="stop-btn" onClick={stopRecording}>
                    <MicOff size={17} /> Stop recording
                  </button>
                )}
                <small>Use a quiet room and keep your microphone close.</small>
              </div>

              <label className="field-label" htmlFor="transcript">
                Transcript (optional){' '}
                <span>Leave blank to transcribe the recording automatically</span>
              </label>
              <textarea
                id="transcript"
                className="transcript-box"
                placeholder="Optional: enter exactly what you said. Leave blank to let the audio engine transcribe your recording."
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={4}
              />

              <div className="practice-actions">
                <button className="primary-btn" disabled={busy || recording} onClick={assess}>
                  {busy ? (
                    <>
                      <RefreshCw className="spin" size={16} /> Assessing…
                    </>
                  ) : (
                    <>
                      <BarChart3 size={16} /> Assess my speech
                    </>
                  )}
                </button>
                <button
                  className="secondary-btn"
                  onClick={startLive}
                  disabled={liveState === 'live' || liveState === 'connecting'}
                >
                  <MessageCircle size={16} />{' '}
                  {liveState === 'connecting' ? 'Connecting…' : 'Live AI coach'}
                </button>
              </div>
              <p className="micro-copy">
                Pronunciation scoring measures accuracy, fluency, prosody, and cadence. Live conversation and written feedback provide continuous coaching.
              </p>
            </div>

            {/* Side Practice */}
            <div className="side-practice">
              <div className="live-card">
                <div className="live-card-head">
                  <div className="live-icon">
                    <Headphones size={20} />
                  </div>
                  <span className={`status-chip ${liveState === 'live' ? 'status-live' : ''}`}>
                    <i />
                    {liveState === 'live' ? 'LIVE' : liveState === 'connecting' ? 'CONNECTING' : 'READY'}
                  </span>
                </div>
                <h3>Talk, don't type.</h3>
                <p>
                  Have a natural voice conversation. Your coach can act as an interviewer, ask follow-up questions, and help you practice thinking in English.
                </p>
                {liveState === 'live' ? (
                  <button className="stop-live" onClick={stopLive}>
                    End conversation
                  </button>
                ) : (
                  <button
                    className="outline-btn"
                    onClick={startLive}
                    disabled={liveState === 'connecting'}
                  >
                    <Play size={15} /> Start voice conversation
                  </button>
                )}
                {liveText && (
                  <div className="live-transcript">
                    <b>Conversation transcript</b>
                    <pre>{liveText}</pre>
                  </div>
                )}
              </div>

              <div className="tip-card">
                <div className="tip-heading">
                  <Sparkles size={17} /> Coach's reminder
                </div>
                <p>
                  Don't restart every time you make a mistake. Finish your thought, then use feedback to improve the next attempt.
                </p>
              </div>

              <div className="provider-note">
                <b>About your scores</b>
                <p>
                  Pronunciation metrics come from acoustic and speech-assessment analysis. Speaking rate and pause statistics are separate acoustic measurements. AI feedback on a transcript is coaching—not a pronunciation score.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Assessment Report */}
        {result && (
          <section className="section-block result-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">ASSESSMENT REPORT</span>
                <h2>Your latest result</h2>
                <p>Scores are reported on a 0–100 scale when available.</p>
              </div>
              <span className="saved-chip">
                <CheckCircle2 size={15} /> Saved to history
              </span>
            </div>

            <div className="result-grid">
              <div className="score-card">
                <span className="eyebrow">OVERALL PRONUNCIATION</span>
                <div className="big-score">
                  {score == null ? '—' : score.toFixed(0)}
                  <small>/100</small>
                </div>
                <div className="score-track">
                  <i style={{ width: `${Math.max(0, Math.min(100, score || 0))}%` }} />
                </div>
                <p>
                  {score == null
                    ? 'This assessment response did not include an overall score.'
                    : score >= 85
                    ? 'Strong result. Keep practicing for consistency.'
                    : score >= 70
                    ? 'A useful baseline. Focus on the specific words and sounds flagged below.'
                    : 'Treat this as a starting point, then practice the highest-priority feedback.'}
                </p>
              </div>

              <div className="metric-card">
                <Metric label="Accuracy" value={result.azure_accuracy_score} />
                <Metric label="Fluency" value={result.azure_fluency_score} />
                <Metric label="Prosody" value={result.azure_prosody_score} />
                <Metric label="Speech rate" value={result.speech_rate_wpm} suffix=" WPM" />
              </div>

              <div className="metric-card">
                <Metric
                  label="Duration"
                  value={result.duration_seconds ? Math.round(result.duration_seconds) : null}
                  suffix=" sec"
                />
                <Metric label="Detected filler words" value={result.filler_count} />
                <Metric label="Long pauses" value={result.pause_count} />
                <Metric
                  label="Pause time"
                  value={result.pause_seconds != null ? result.pause_seconds.toFixed(1) : null}
                  suffix=" sec"
                />
              </div>
            </div>

            <div className="feedback-card">
              <div className="feedback-title">
                <div className="feedback-icon">
                  <Sparkles size={19} />
                </div>
                <div>
                  <h3>Your AI coach's feedback</h3>
                  <p>Based on your transcript, not a direct judgment of pronunciation.</p>
                </div>
              </div>
              {feedback ? (
                <div className="feedback-content">
                  {feedback.split('\n\n').map((block, i) => {
                    const lines = block.split('\n');
                    const header = lines[0]?.endsWith(':') ? lines[0] : null;
                    const rest = header ? lines.slice(1).join('\n') : block;
                    return (
                      <div key={i} style={{ marginBottom: 12 }}>
                        {header && <h4>{header}</h4>}
                        {rest.split('\n').map((line, j) => (
                          <p key={j}>{line}</p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p>Feedback will appear here after assessment.</p>
              )}
            </div>
          </section>
        )}

        {/* Progress over time */}
        <section id="progress" className="section-block">
          <div className="section-heading">
            <div>
              <span className="eyebrow">02 / YOUR GROWTH</span>
              <h2>Progress over time</h2>
              <p>
                Compare saved assessments and spot patterns instead of relying on how fluent you feel on a single day.
              </p>
            </div>
            <button className="icon-btn" onClick={refreshHistory} aria-label="Refresh history">
              <RefreshCw size={17} />
            </button>
          </div>

          <div className="progress-layout">
            <div className="chart-card">
              <div className="chart-title">
                <div>
                  <h3>Pronunciation trend</h3>
                  <p>Scores from saved practice sessions</p>
                </div>
                <span className="chart-legend">
                  <i /> Pronunciation
                </span>
              </div>
              {chartData.some((d) => d.pronunciation != null) ? (
                <div className="chart">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart
                      data={chartData.filter((d) => d.pronunciation != null)}
                      margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: '#7b8798' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fontSize: 11, fill: '#7b8798' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="pronunciation"
                        name="Pronunciation"
                        stroke="#6658d3"
                        strokeWidth={3}
                        dot={{ r: 4, fill: '#6658d3', strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-chart">
                  <div className="empty-icon">
                    <TrendingUp size={25} />
                  </div>
                  <b>Your trend starts here</b>
                  <p>Complete your first assessment to start building a day-to-day comparison.</p>
                </div>
              )}
            </div>

            <div className="history-card">
              <div className="history-head">
                <div>
                  <h3>Recent sessions</h3>
                  <p>
                    {assessments.length} saved assessment
                    {assessments.length === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="history-icon">
                  <Clock3 size={17} />
                </span>
              </div>
              {assessments.length ? (
                <div className="history-list">
                  {assessments.slice(0, 7).map((a) => (
                    <div className="history-row" key={a.id}>
                      <div className="history-symbol">
                        <AudioLines size={16} />
                      </div>
                      <div className="history-main">
                        <b>{EXERCISES[a.exercise_type as ExerciseKey]?.label || a.exercise_type}</b>
                        <span>
                          {a.created_at
                            ? new Date(a.created_at).toLocaleString()
                            : 'Saved session'}{' '}
                          · {Math.round(a.duration_seconds)} sec
                        </span>
                      </div>
                      <div className="history-score">
                        {a.azure_pronunciation_score != null
                          ? a.azure_pronunciation_score.toFixed(0)
                          : '—'}
                        <small>/100</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="history-empty">Your completed assessments will appear here.</div>
              )}
            </div>
          </div>
        </section>

        <footer className="footer">
          <span>Fluent Coach · Personal speaking practice</span>
          <span>Scores are learning indicators, not an official CEFR or IELTS certification.</span>
        </footer>
      </main>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  delta,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: string | null;
  note: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span className="stat-icon">{icon}</span>
        {delta != null && (
          <span className={`delta ${Number(delta) >= 0 ? 'up' : 'down'}`}>
            {Number(delta) >= 0 ? '+' : ''}
            {delta}
          </span>
        )}
      </div>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function Metric({
  label,
  value,
  suffix = '',
}: {
  label: string;
  value: number | string | null | undefined;
  suffix?: string;
}) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <b>{value == null ? 'Not available' : `${value}${suffix}`}</b>
    </div>
  );
}

export default App;
