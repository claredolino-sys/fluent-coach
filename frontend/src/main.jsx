import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, AudioLines, BarChart3, BookOpen, BriefcaseBusiness, CheckCircle2, CircleHelp, Clock3, Headphones, Mic, MicOff, MessageCircle, Play, RefreshCw, Send, Sparkles, Target, TrendingUp, Volume2 } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './styles.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const exercises = {
  baseline: { label: 'Daily baseline', title: 'Tell me about yourself', prompt: 'Tell me about yourself, what you have been working toward recently, and one strength you would bring to a new opportunity.', type: 'baseline' },
  interview: { label: 'Job interview', title: 'Answer with confidence', prompt: 'Tell me about a challenge you faced and how you handled it. Explain the situation, the action you took, and the result.', type: 'interview' },
  everyday: { label: 'Everyday conversation', title: 'Speak naturally', prompt: 'Describe something interesting that happened recently and explain why it mattered to you.', type: 'everyday' },
  storytelling: { label: 'Storytelling', title: 'Make the story clear', prompt: 'Tell a short story about a time you learned something important. Include the beginning, what happened, and what you learned.', type: 'storytelling' },
  workplace: { label: 'Workplace English', title: 'Explain an idea professionally', prompt: 'Imagine you need to explain a new idea to your team. Describe the idea, why it helps, and what you need from your colleagues.', type: 'workplace' }
}

function floatToWavBlob(chunks, sampleRate) {
  const length = chunks.reduce((n, c) => n + c.length, 0)
  const samples = new Float32Array(length); let offset = 0
  chunks.forEach(c => { samples.set(c, offset); offset += c.length })
  const targetRate = 16000
  const ratio = sampleRate / targetRate
  const outLength = Math.floor(samples.length / ratio)
  const pcm = new Int16Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio), end = Math.min(Math.floor((i + 1) * ratio), samples.length)
    let sum = 0; for (let j = start; j < end; j++) sum += samples[j]
    const v = sum / Math.max(1, end - start)
    pcm[i] = Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767)
  }
  const buffer = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(buffer)
  const write = (s, p) => { for (let i = 0; i < s.length; i++) view.setUint8(p + i, s.charCodeAt(i)) }
  write('RIFF', 0); view.setUint32(4, 36 + pcm.length * 2, true); write('WAVE', 8); write('fmt ', 12)
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, targetRate, true)
  view.setUint32(28, targetRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write('data', 36); view.setUint32(40, pcm.length * 2, true)
  new Int16Array(buffer, 44).set(pcm)
  return new Blob([buffer], { type: 'audio/wav' })
}

function App() {
  const [mode, setMode] = useState('baseline'), [transcript, setTranscript] = useState(''), [prompt, setPrompt] = useState(exercises.baseline.prompt)
  const [recording, setRecording] = useState(false), [seconds, setSeconds] = useState(0), [busy, setBusy] = useState(false)
  const [assessments, setAssessments] = useState([]), [result, setResult] = useState(null), [feedback, setFeedback] = useState(''), [error, setError] = useState('')
  const [liveState, setLiveState] = useState('idle'), [liveText, setLiveText] = useState('')
  const recRef = useRef(null), chunksRef = useRef([]), streamRef = useRef(null), contextRef = useRef(null), processorRef = useRef(null), timerRef = useRef(null), startRef = useRef(0), pauseRef = useRef({count:0, seconds:0, quietStart:null}), pcRef = useRef(null), dcRef = useRef(null), audioOutRef = useRef(null)
  const current = exercises[mode]

  async function refreshHistory() {
    try { const r = await fetch(`${API}/api/assessments?limit=60`); if (!r.ok) throw new Error(); setAssessments(await r.json()) }
    catch { setError('Cannot reach the backend yet. Start the API server and check the setup instructions.') }
  }
  useEffect(() => { refreshHistory() }, [])
  useEffect(() => { setPrompt(current.prompt); setResult(null); setFeedback('') }, [mode])
  useEffect(() => { if (recording) { timerRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - startRef.current) / 1000)), 250) } else clearInterval(timerRef.current); return () => clearInterval(timerRef.current) }, [recording])

  async function startRecording() {
    setError(''); setTranscript(''); setResult(null); setFeedback(''); chunksRef.current = []; pauseRef.current = {count:0, seconds:0, quietStart:null};
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); streamRef.current = stream
      const ctx = new AudioContext(); contextRef.current = ctx; const source = ctx.createMediaStreamSource(stream); const processor = ctx.createScriptProcessor(4096, 1, 1); processorRef.current = processor
      processor.onaudioprocess = e => {
        const data = e.inputBuffer.getChannelData(0); chunksRef.current.push(new Float32Array(data))
        let energy = 0; for (let i=0;i<data.length;i++) energy += data[i]*data[i]; const rms = Math.sqrt(energy/data.length); const now = Date.now()
        if (rms < 0.012) { if (pauseRef.current.quietStart === null) pauseRef.current.quietStart = now }
        else if (pauseRef.current.quietStart !== null) { const d = (now-pauseRef.current.quietStart)/1000; if (d >= 0.45) { pauseRef.current.count++; pauseRef.current.seconds += d } pauseRef.current.quietStart = null }
      }
      source.connect(processor); processor.connect(ctx.destination); startRef.current = Date.now(); setSeconds(0); setRecording(true)
    } catch { setError('Microphone access failed. Allow microphone access in your browser and try again.') }
  }
  async function stopRecording() {
    if (!recording) return
    setRecording(false)
    const elapsed = Math.max(1, (Date.now() - startRef.current)/1000); setSeconds(Math.round(elapsed))
    const wav = floatToWavBlob(chunksRef.current, contextRef.current?.sampleRate || 44100)
    processorRef.current?.disconnect(); contextRef.current?.close(); streamRef.current?.getTracks().forEach(t => t.stop())
    recRef.current = { wav, elapsed, pauses: {...pauseRef.current} }
  }
  async function assess() {
    if (!recRef.current?.wav) { setError('Record a response first.'); return }
    
    setBusy(true); setError(''); setFeedback('')
    try {
      const form = new FormData(); form.append('audio', recRef.current.wav, 'speech.wav'); form.append('reference_text', transcript.trim()); form.append('exercise_type', mode); form.append('duration_seconds', String(recRef.current.elapsed)); form.append('pause_count', String(recRef.current.pauses.count)); form.append('pause_seconds', String(recRef.current.pauses.seconds))
      const r = await fetch(`${API}/api/assess`, { method:'POST', body:form }); const data = await r.json(); if (!r.ok) throw new Error(data.detail || 'Assessment failed'); setResult(data); await refreshHistory()
      const f = await fetch(`${API}/api/feedback`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transcript: data.transcript || transcript, prompt, exercise_type:mode})})
      const fd = await f.json(); if (f.ok) setFeedback(fd.feedback); else setFeedback(`Assessment saved. AI feedback unavailable: ${fd.detail || 'check OpenAI configuration'}`)
    } catch(e) { setError(e.message || 'Assessment failed. Check that the backend and provider keys are configured.') }
    finally { setBusy(false) }
  }
  async function startLive() {
    setError(''); setLiveText(''); setLiveState('connecting')
    try {
      const res = await fetch(`${API}/api/realtime/session`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({exercise_type:mode})}); const session = await res.json()
      if (!res.ok) throw new Error(session.detail || 'Could not create live session')
      const secret = session.client_secret?.value || session.value
      if (!secret) throw new Error('Realtime session did not return a temporary client secret. Check the API response and model access.')
      const pc = new RTCPeerConnection(); pcRef.current = pc
      const audio = new Audio(); audio.autoplay = true; audioOutRef.current = audio; pc.ontrack = e => { audio.srcObject = e.streams[0] }
      const stream = await navigator.mediaDevices.getUserMedia({audio:true}); stream.getTracks().forEach(t => pc.addTrack(t, stream))
      const dc = pc.createDataChannel('oai-events'); dcRef.current = dc
      dc.onmessage = e => { try { const msg = JSON.parse(e.data); if (msg.type === 'conversation.item.input_audio_transcription.completed') setLiveText(t => t + '\nYou: ' + msg.transcript); if (msg.type === 'response.audio_transcript.done' || msg.type === 'response.output_audio_transcript.done') setLiveText(t => t + '\nCoach: ' + msg.transcript); if (msg.type === 'error') setError(msg.error?.message || 'Live conversation error') } catch {} }
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer)
      const call = await fetch('https://api.openai.com/v1/realtime/calls', {method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/sdp'},body:offer.sdp})
      if (!call.ok) throw new Error(`Realtime connection failed (${call.status}). Check API access and model configuration.`)
      await pc.setRemoteDescription({type:'answer',sdp:await call.text()}); setLiveState('live')
      dc.onopen = () => dc.send(JSON.stringify({type:'response.create',response:{instructions:`Start a ${mode} English speaking practice. Ask this first question: ${current.prompt}. Speak naturally and ask only one question at a time.`}}))
    } catch(e) { setLiveState('idle'); setError(e.message || 'Could not start live coach.') }
  }
  function stopLive() { dcRef.current?.close(); pcRef.current?.getSenders().forEach(s => s.track?.stop()); pcRef.current?.close(); pcRef.current = null; setLiveState('idle') }

  const chartData = useMemo(() => [...assessments].reverse().map((a,i) => ({name: new Date(a.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}), id:a.id, pronunciation:a.azure_pronunciation_score, accuracy:a.azure_accuracy_score, fluency:a.azure_fluency_score, wpm:a.speech_rate_wpm})), [assessments])
  const latest = assessments[0]
  const delta = (key) => { if (!latest) return null; const older = assessments.find(a => a.id !== latest.id && a[key] != null); return older ? Number(latest[key] - older[key]).toFixed(1) : null }
  const score = result?.azure_pronunciation_score

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-icon"><AudioLines size={23}/></div><div><b>Fluent Coach</b><span>Speak with confidence</span></div></div>
      <div className="side-label">YOUR WORKSPACE</div><button className="nav active"><Activity size={18}/> Overview</button><button className="nav" onClick={()=>document.getElementById('practice')?.scrollIntoView({behavior:'smooth'})}><Mic size={18}/> Speaking lab</button><button className="nav" onClick={()=>document.getElementById('progress')?.scrollIntoView({behavior:'smooth'})}><TrendingUp size={18}/> Progress</button>
      <div className="sidebar-note"><div className="note-icon"><Target size={18}/></div><b>Your goal</b><p>Build back your advanced English fluency, one real conversation at a time.</p></div><div className="sidebar-footer"><span className="online-dot"/> Personal practice space</div>
    </aside>
    <main className="main-content"><header className="topbar"><div><span className="eyebrow">YOUR PERSONAL SPEAKING COACH</span><h1>Good to see you.</h1><p>Practice freely. Measure what matters. Notice your progress.</p></div><div className="date-pill"><Clock3 size={15}/>{new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</div></header>
      {error && <div className="error-banner"><CircleHelp size={18}/><span>{error}</span><button onClick={()=>setError('')}>Dismiss</button></div>}
      <section className="welcome-card"><div className="welcome-copy"><span className="welcome-tag"><Sparkles size={14}/> YOUR FLUENCY RESET</span><h2>Your voice gets stronger<br/>every time you use it.</h2><p>Practice the way you actually speak—not the way you memorize. Get detailed feedback and compare repeatable assessments over time.</p><button className="primary-btn" onClick={()=>document.getElementById('practice')?.scrollIntoView({behavior:'smooth'})}>Start today's practice <span>→</span></button></div><div className="welcome-art"><div className="orb orb-one"/><div className="orb orb-two"/><div className="sound-bars">{[25,42,62,38,76,48,88,58,35,68,45,78,30].map((h,i)=><i key={i} style={{height:h+'px'}}/>)}</div><div className="art-label"><span className="online-dot"/> Your progress, made visible</div></div></section>
      <section className="stats-grid"><Stat icon={<Target/>} label="Latest pronunciation" value={latest?.azure_pronunciation_score != null ? `${latest.azure_pronunciation_score.toFixed(0)}/100` : '—'} delta={delta('azure_pronunciation_score')} note="Provider score"/><Stat icon={<AudioLines/>} label="Pronunciation accuracy" value={latest?.azure_accuracy_score != null ? `${latest.azure_accuracy_score.toFixed(0)}/100` : '—'} delta={delta('azure_accuracy_score')} note="Word / phoneme feedback"/><Stat icon={<Activity/>} label="Speaking rate" value={latest?.speech_rate_wpm != null ? `${latest.speech_rate_wpm}` : '—'} delta={delta('speech_rate_wpm')} note="Words per minute"/><Stat icon={<CheckCircle2/>} label="Sessions saved" value={String(assessments.length)} note="Your recorded history"/></section>
      <section id="practice" className="section-block"><div className="section-heading"><div><span className="eyebrow">01 / SPEAKING LAB</span><h2>Choose your practice</h2><p>Record a response for scored pronunciation assessment, or talk live with your AI coach.</p></div></div>
        <div className="practice-layout"><div className="practice-card"><div className="mode-tabs">{Object.entries(exercises).map(([key,item])=><button key={key} className={mode===key?'selected':''} onClick={()=>{setMode(key);setTranscript('');recRef.current=null}}>{item.label}</button>)}</div><div className="prompt-box"><div className="prompt-top"><span className="prompt-label"><BookOpen size={15}/> TODAY'S PROMPT</span><button className="text-btn" onClick={()=>{setPrompt(current.prompt);setTranscript('');recRef.current=null}}>Reset prompt</button></div><h3>{current.title}</h3><p>{prompt}</p><textarea className="prompt-edit" aria-label="Edit practice prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} rows={2}/></div>
          <div className="record-area"><div className={`mic-orbit ${recording?'recording':''}`}><div className="mic-core"><Mic size={28}/></div><span className="orbit-ring ring-a"/><span className="orbit-ring ring-b"/></div><div className="record-time">{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</div><p>{recording?'Listening… speak naturally and finish your thought.':'When you are ready, answer in your own words.'}</p>{!recording?<button className="record-btn" onClick={startRecording}><Mic size={17}/> Start recording</button>:<button className="stop-btn" onClick={stopRecording}><MicOff size={17}/> Stop recording</button>}<small>Use a quiet room and keep your microphone close.</small></div>
          <label className="field-label" htmlFor="transcript">Transcript (optional) <span>Leave blank to transcribe the recording automatically</span></label><textarea id="transcript" className="transcript-box" placeholder="Optional: enter exactly what you said. Leave blank to let the backend transcribe your recording." value={transcript} onChange={e=>setTranscript(e.target.value)} rows={4}/><div className="practice-actions"><button className="primary-btn" disabled={busy||recording} onClick={assess}>{busy?<><RefreshCw className="spin" size={16}/> Assessing…</>:<><BarChart3 size={16}/> Assess my speech</>}</button><button className="secondary-btn" onClick={startLive} disabled={liveState==='live'||liveState==='connecting'}><MessageCircle size={16}/> {liveState==='connecting'?'Connecting…':'Live AI coach'}</button></div><p className="micro-copy">Pronunciation scoring requires an Azure Speech key. Live conversation and written feedback require an OpenAI API key.</p>
          </div>
          <div className="side-practice"><div className="live-card"><div className="live-card-head"><div className="live-icon"><Headphones size={20}/></div><span className={`status-chip ${liveState==='live'?'status-live':''}`}><i/>{liveState==='live'?'LIVE':liveState==='connecting'?'CONNECTING':'READY'}</span></div><h3>Talk, don't type.</h3><p>Have a natural voice conversation. Your coach can act as an interviewer, ask follow-up questions, and help you practice thinking in English.</p>{liveState==='live'?<button className="stop-live" onClick={stopLive}>End conversation</button>:<button className="outline-btn" onClick={startLive} disabled={liveState==='connecting'}><Play size={15}/> Start voice conversation</button>}{liveText && <div className="live-transcript"><b>Conversation transcript</b><pre>{liveText}</pre></div>}</div>
            <div className="tip-card"><div className="tip-heading"><Sparkles size={17}/> Coach's reminder</div><p>Don't restart every time you make a mistake. Finish your thought, then use feedback to improve the next attempt.</p></div><div className="provider-note"><b>About your scores</b><p>Pronunciation metrics come from the configured speech-assessment provider. Speaking rate and pause statistics are separate acoustic measurements. AI feedback on a transcript is coaching—not a pronunciation score.</p></div></div></div>
      </section>
      {result && <section className="section-block result-section"><div className="section-heading"><div><span className="eyebrow">ASSESSMENT REPORT</span><h2>Your latest result</h2><p>Provider scores are reported on a 0–100 scale when available.</p></div><span className="saved-chip"><CheckCircle2 size={15}/> Saved to history</span></div><div className="result-grid"><div className="score-card"><span className="eyebrow">OVERALL PRONUNCIATION</span><div className="big-score">{score==null?'—':score.toFixed(0)}<small>/100</small></div><div className="score-track"><i style={{width:`${Math.max(0,Math.min(100,score||0))}%`}}/></div><p>{score==null?'This provider response did not include an overall score.':score>=85?'Strong result. Keep practicing for consistency.':score>=70?'A useful baseline. Focus on the specific words and sounds flagged below.':'Treat this as a starting point, then practice the highest-priority feedback.'}</p></div><div className="metric-card"><Metric label="Accuracy" value={result.azure_accuracy_score}/><Metric label="Fluency" value={result.azure_fluency_score}/><Metric label="Prosody" value={result.azure_prosody_score}/><Metric label="Speech rate" value={result.speech_rate_wpm} suffix=" WPM"/></div><div className="metric-card"><Metric label="Duration" value={result.duration_seconds ? Math.round(result.duration_seconds) : null} suffix=" sec"/><Metric label="Detected filler words" value={result.filler_count}/><Metric label="Long pauses" value={result.pause_count}/><Metric label="Pause time" value={result.pause_seconds != null ? result.pause_seconds.toFixed(1):null} suffix=" sec"/></div></div><div className="feedback-card"><div className="feedback-title"><div className="feedback-icon"><Sparkles size={19}/></div><div><h3>Your AI coach's feedback</h3><p>Based on your transcript, not a direct judgment of pronunciation.</p></div></div>{feedback?<div className="feedback-content">{feedback.split('\n').map((line,i)=>line.trim()?<p key={i}>{line}</p>:null)}</div>:<p>Feedback will appear here after assessment.</p>}</div></section>}
      <section id="progress" className="section-block"><div className="section-heading"><div><span className="eyebrow">02 / YOUR GROWTH</span><h2>Progress over time</h2><p>Compare saved assessments and spot patterns instead of relying on how fluent you feel on a single day.</p></div><button className="icon-btn" onClick={refreshHistory} aria-label="Refresh history"><RefreshCw size={17}/></button></div><div className="progress-layout"><div className="chart-card"><div className="chart-title"><div><h3>Pronunciation trend</h3><p>Azure provider scores from saved sessions</p></div><span className="chart-legend"><i/> Pronunciation</span></div>{chartData.some(d=>d.pronunciation!=null)?<div className="chart"><ResponsiveContainer width="100%" height="260"><LineChart data={chartData.filter(d=>d.pronunciation!=null)} margin={{top:12,right:12,bottom:4,left:0}}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3"/><XAxis dataKey="name" tick={{fontSize:11,fill:'#7b8798'}} axisLine={false} tickLine={false}/><YAxis domain={[0,100]} tick={{fontSize:11,fill:'#7b8798'}} axisLine={false} tickLine={false}/><Tooltip/><Line type="monotone" dataKey="pronunciation" name="Pronunciation" stroke="#6658d3" strokeWidth={3} dot={{r:4,fill:'#6658d3',strokeWidth:2,stroke:'#fff'}} activeDot={{r:6}}/></LineChart></ResponsiveContainer></div>:<div className="empty-chart"><div className="empty-icon"><TrendingUp size={25}/></div><b>Your trend starts here</b><p>Complete your first assessment to start building a day-to-day comparison.</p></div>}</div>
        <div className="history-card"><div className="history-head"><div><h3>Recent sessions</h3><p>{assessments.length} saved assessment{assessments.length===1?'':'s'}</p></div><span className="history-icon"><Clock3 size={17}/></span></div>{assessments.length? <div className="history-list">{assessments.slice(0,7).map(a=><div className="history-row" key={a.id}><div className="history-symbol"><AudioLines size={16}/></div><div className="history-main"><b>{exercises[a.exercise_type]?.label || a.exercise_type}</b><span>{a.created_at?new Date(a.created_at).toLocaleString(): 'Saved session'} · {Math.round(a.duration_seconds)} sec</span></div><div className="history-score">{a.azure_pronunciation_score!=null?a.azure_pronunciation_score.toFixed(0):'—'}<small>/100</small></div></div>)}</div>:<div className="history-empty">Your completed assessments will appear here.</div>}</div></div>
      </section>
      <footer className="footer"><span>Fluent Coach · Personal speaking practice</span><span>Scores are learning indicators, not an official CEFR or IELTS certification.</span></footer>
    </main>
  </div>
}
function Stat({icon,label,value,delta,note}) { return <div className="stat-card"><div className="stat-top"><span className="stat-icon">{icon}</span>{delta!=null&&<span className={`delta ${Number(delta)>=0?'up':'down'}`}>{Number(delta)>=0?'+':''}{delta}</span>}</div><span className="stat-label">{label}</span><strong>{value}</strong><small>{note}</small></div> }
function Metric({label,value,suffix=''}) { return <div className="metric-row"><span>{label}</span><b>{value==null?'Not available':`${value}${suffix}`}</b></div> }

createRoot(document.getElementById('root')).render(<App />)
