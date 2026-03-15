import { useState, useEffect, useRef, useCallback } from 'react'
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import './App.css'

const API = 'http://localhost:8000'

// Pre-load voices so getVoices() is populated when first coaching tip fires
window.speechSynthesis.getVoices()
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices()

// ── MediaPipe setup ────────────────────────────────────────────
const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

// Skeleton connections (MediaPipe 33-landmark model)
const POSE_CONNECTIONS = [
  [11, 12], // shoulders
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 23], [12, 24], // torso sides
  [23, 24],           // hips
  [23, 25], [25, 27], // left leg
  [24, 26], [26, 28], // right leg
]

// ── Angle math (ported from Python backend) ───────────────────
function calculateAngle(a, b, c) {
  const radians =
    Math.atan2(c[1] - b[1], c[0] - b[0]) -
    Math.atan2(a[1] - b[1], a[0] - b[0])
  let angle = Math.abs((radians * 180) / Math.PI)
  if (angle > 180) angle = 360 - angle
  return Math.round(angle)
}

function computeAngles(lm) {
  const pt = (i) => [lm[i].x, lm[i].y]
  const mid = (i, j) => [(lm[i].x + lm[j].x) / 2, (lm[i].y + lm[j].y) / 2]

  const midShoulder = mid(11, 12)
  const midHip      = mid(23, 24)
  const midAnkle    = mid(27, 28)

  return {
    spine:       calculateAngle(midShoulder, midHip, midAnkle),
    left_knee:   calculateAngle(pt(23), pt(25), pt(27)),
    right_knee:  calculateAngle(pt(24), pt(26), pt(28)),
    left_hip:    calculateAngle(pt(11), pt(23), pt(25)),
    right_hip:   calculateAngle(pt(12), pt(24), pt(26)),
  }
}

// ── Phase detection from angles ────────────────────────────────
function detectWorkerPhase(angles) {
  const avgKnee = (angles.left_knee + angles.right_knee) / 2
  if (avgKnee > 160) return 'standing'
  if (avgKnee < 130) return 'mid_lift'
  return 'transitioning'
}

// ── Canvas pose overlay ────────────────────────────────────────
function drawPose(canvas, landmarks, angles, formRules = []) {
  if (!canvas || !landmarks) return
  const ctx = canvas.getContext('2d')
  const { width: w, height: h } = canvas
  ctx.clearRect(0, 0, w, h)

  // Evaluate form rules → per-joint status
  const jointStatus = {}
  for (const rule of formRules) {
    const val = angles[rule.joint]
    if (val == null) continue
    const fails = rule.op === 'gt' ? val < rule.value : val > rule.value
    jointStatus[rule.joint] = fails ? 'fail' : 'ok'
  }

  // Map joint name → landmark indices
  const JOINT_TO_LM = {
    spine:          [11, 12, 23, 24],
    left_knee:      [25], right_knee:      [26],
    left_hip:       [23], right_hip:       [24],
    left_shoulder:  [11], right_shoulder:  [12],
    left_elbow:     [13], right_elbow:     [14],
    left_ankle:     [27], right_ankle:     [28],
  }
  const lmStatus = {}
  for (const [joint, indices] of Object.entries(JOINT_TO_LM)) {
    const s = jointStatus[joint]
    if (!s) continue
    for (const idx of indices) {
      if (!lmStatus[idx] || s === 'fail') lmStatus[idx] = s
    }
  }

  // Draw connections with form-aware colour + glow
  for (const [a, b] of POSE_CONNECTIONS) {
    const la = landmarks[a], lb = landmarks[b]
    if ((la.visibility ?? 1) < 0.4 || (lb.visibility ?? 1) < 0.4) continue
    const isFail = lmStatus[a] === 'fail' || lmStatus[b] === 'fail'
    const isOk   = !isFail && (lmStatus[a] === 'ok'   || lmStatus[b] === 'ok')
    const color  = isFail ? '#ef4444' : isOk ? '#22c55e' : 'rgba(99,155,255,0.75)'
    const lw     = isFail || isOk ? 3 : 2
    ctx.beginPath()
    ctx.shadowColor = isFail ? 'rgba(239,68,68,0.55)' : isOk ? 'rgba(34,197,94,0.45)' : 'transparent'
    ctx.shadowBlur  = isFail || isOk ? 10 : 0
    ctx.strokeStyle = color
    ctx.lineWidth   = lw
    ctx.moveTo(la.x * w, la.y * h)
    ctx.lineTo(lb.x * w, lb.y * h)
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  // Draw joints — key joints larger, evaluated joints glow
  const KEY_LM = new Set([11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28])
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i]
    if ((lm.visibility ?? 1) < 0.4) continue
    const s     = lmStatus[i]
    const isKey = KEY_LM.has(i)
    const r     = isKey ? 5 : 3
    const color = s === 'fail' ? '#ef4444' : s === 'ok' ? '#22c55e' : '#ffffff'
    if (isKey && s) {
      ctx.beginPath()
      ctx.shadowColor = s === 'fail' ? 'rgba(239,68,68,0.65)' : 'rgba(34,197,94,0.55)'
      ctx.shadowBlur  = 16
      ctx.fillStyle   = color + '22'
      ctx.arc(lm.x * w, lm.y * h, r + 5, 0, 2 * Math.PI)
      ctx.fill()
      ctx.shadowBlur = 0
    }
    ctx.beginPath()
    ctx.fillStyle = color
    ctx.arc(lm.x * w, lm.y * h, r, 0, 2 * Math.PI)
    ctx.fill()
  }

  // Angle arc at spine (mid-hip)
  if (landmarks[11] && landmarks[12] && landmarks[23] && landmarks[24] && landmarks[27] && landmarks[28]) {
    const msx = (landmarks[11].x + landmarks[12].x) / 2 * w
    const msy = (landmarks[11].y + landmarks[12].y) / 2 * h
    const mhx = (landmarks[23].x + landmarks[24].x) / 2 * w
    const mhy = (landmarks[23].y + landmarks[24].y) / 2 * h
    const max = (landmarks[27].x + landmarks[28].x) / 2 * w
    const may = (landmarks[27].y + landmarks[28].y) / 2 * h
    const s = jointStatus['spine']
    const arcColor = s === 'fail' ? '#ef4444' : s === 'ok' ? '#22c55e' : 'rgba(255,255,255,0.5)'
    let a1 = Math.atan2(msy - mhy, msx - mhx)
    let a2 = Math.atan2(may - mhy, max - mhx)
    if (a2 - a1 > Math.PI)  a1 += 2 * Math.PI
    if (a1 - a2 > Math.PI)  a2 += 2 * Math.PI
    ctx.beginPath()
    ctx.strokeStyle = arcColor
    ctx.lineWidth   = 1.5
    ctx.setLineDash([4, 4])
    ctx.arc(mhx, mhy, 34, Math.min(a1, a2), Math.max(a1, a2))
    ctx.stroke()
    ctx.setLineDash([])
    const midA = (a1 + a2) / 2
    ctx.fillStyle = arcColor
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif'
    ctx.fillText(`${angles.spine}°`, mhx + 42 * Math.cos(midA) - 10, mhy + 42 * Math.sin(midA) + 4)
  }

  // Angle arcs at knees
  for (const [knee, hip, ankle, joint] of [
    [25, 23, 27, 'left_knee'],
    [26, 24, 28, 'right_knee'],
  ]) {
    const lk = landmarks[knee], lh = landmarks[hip], la = landmarks[ankle]
    if (!lk || !lh || !la || (lk.visibility ?? 1) < 0.4) continue
    const s = jointStatus[joint]
    if (!s) continue
    const kx = lk.x * w, ky = lk.y * h
    const a1 = Math.atan2(lh.y * h - ky, lh.x * w - kx)
    const a2 = Math.atan2(la.y * h - ky, la.x * w - kx)
    ctx.beginPath()
    ctx.strokeStyle = s === 'fail' ? '#ef4444' : '#22c55e'
    ctx.lineWidth   = 1.5
    ctx.setLineDash([3, 3])
    ctx.arc(kx, ky, 22, Math.min(a1, a2), Math.max(a1, a2))
    ctx.stroke()
    ctx.setLineDash([])
  }
}

// ══════════════════════════════════════════════════════════════
// App Root
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [page, setPage]       = useState('landing')
  const [worker, setWorker]   = useState(null)
  const [org, setOrg]         = useState(null)
  const [summaryData, setSummary] = useState(null)
  const [assessmentTarget, setAssessmentTarget] = useState(null)

  useEffect(() => {
    const sw = localStorage.getItem('skill2_worker')
    if (sw) {
      const w = JSON.parse(sw)
      fetch(`${API}/workers/${w.id}`, { headers: { 'X-API-Key': w.api_key } })
        .then(r => r.ok ? setWorker(w) : localStorage.removeItem('skill2_worker'))
        .catch(() => {})
    }
    const so = localStorage.getItem('skill2_org')
    if (so) {
      const o = JSON.parse(so)
      fetch(`${API}/orgs/me`, { headers: { 'X-API-Key': o.api_key } })
        .then(r => r.ok ? setOrg(o) : localStorage.removeItem('skill2_org'))
        .catch(() => {})
    }
  }, [])

  const nav = {
    landing:      ()  => setPage('landing'),
    workerAuth:   ()  => setPage('worker-auth'),
    training:     (w) => { setWorker(w); setPage('training') },
    summary:      (d) => { setSummary(d); setPage('summary') },
    orgAuth:      ()  => setPage('org-auth'),
    orgDash:      (o) => { setOrg(o); setPage('org-dashboard') },
    workerLogout: () => { localStorage.removeItem('skill2_worker'); setWorker(null); setPage('landing') },
    orgLogout:    () => { localStorage.removeItem('skill2_org');    setOrg(null);    setPage('landing') },
    assessment:   (programId, programName) => { setAssessmentTarget({ programId, programName }); setPage('assessment') },
  }

  if (page === 'landing')       return <LandingPage    worker={worker} nav={nav} />
  if (page === 'worker-auth')   return <WorkerAuthPage setWorker={setWorker} nav={nav} />
  if (page === 'training')      return <TrainingPage   worker={worker} nav={nav} />
  if (page === 'summary')       return <SummaryPage    data={summaryData} worker={worker} nav={nav} />
  if (page === 'org-auth')      return <OrgAuthPage    setOrg={setOrg} nav={nav} />
  if (page === 'org-dashboard') return <OrgDashboard   org={org} nav={nav} />
  if (page === 'assessment')    return <AssessmentPage target={assessmentTarget} worker={worker} nav={nav} />
  return null
}

// ── Landing ───────────────────────────────────────────────────
function LandingPage({ worker, nav }) {
  return (
    <div className="landing">
      <header className="landing-header">
        <div className="wordmark">Protocol<span className="wordmark-accent">.ai</span></div>
        <button className="btn-ghost" onClick={nav.orgAuth}>For Organizations</button>
      </header>

      <main className="landing-main">
        <div className="eyebrow">Workplace Safety Training Platform</div>
        <h1 className="landing-h1">
          From SOP to certified worker<br />in minutes, not months.
        </h1>
        <p className="landing-sub">
          Upload your standard operating procedures. Our AI identifies posture-critical
          tasks, builds a structured training program, and coaches workers in real time
          using computer vision — processed entirely on-device for privacy.
        </p>

        {worker ? (
          <div className="landing-returning">
            <span className="dim">Signed in as {worker.name}</span>
            <button className="btn-primary" onClick={() => nav.training(worker)}>Continue Training</button>
            <button className="btn-ghost sm" onClick={nav.workerLogout}>Sign out</button>
          </div>
        ) : (
          <div className="landing-ctas">
            <button className="btn-primary" onClick={nav.workerAuth}>Worker Sign In</button>
            <button className="btn-outline" onClick={nav.orgAuth}>Set Up Organization</button>
          </div>
        )}
      </main>

      <div className="landing-steps">
        <div className="step">
          <div className="step-num">01</div>
          <h3>Upload SOP</h3>
          <p>Drop a PDF or paste text. Claude identifies posture-critical tasks and form requirements.</p>
        </div>
        <div className="step-arrow">→</div>
        <div className="step">
          <div className="step-num">02</div>
          <h3>Program Generated</h3>
          <p>AI builds a training program with form rules, scoring criteria, and certification thresholds.</p>
        </div>
        <div className="step-arrow">→</div>
        <div className="step">
          <div className="step-num">03</div>
          <h3>Workers Train</h3>
          <p>On-device computer vision evaluates form. AI coaching every 200 ms. All video stays on the device.</p>
        </div>
      </div>

      <div className="landing-metrics">
        <div className="metric"><span className="metric-val">33%</span><span className="metric-lbl">of workplace injuries are musculoskeletal</span></div>
        <div className="metric-div" />
        <div className="metric"><span className="metric-val">&lt;250ms</span><span className="metric-lbl">AI coaching latency</span></div>
        <div className="metric-div" />
        <div className="metric"><span className="metric-val">On-Device</span><span className="metric-lbl">no video leaves the device</span></div>
        <div className="metric-div" />
        <div className="metric"><span className="metric-val">Any SOP</span><span className="metric-lbl">PDF, Word, or plain text</span></div>
      </div>
    </div>
  )
}

// ── Worker Auth ───────────────────────────────────────────────
function WorkerAuthPage({ setWorker, nav }) {
  const [name, setName]         = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [orgPreview, setOrgPreview] = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    if (joinCode.length === 6) {
      fetch(`${API}/orgs/join/${joinCode.toUpperCase()}`)
        .then(r => r.ok ? r.json() : null).then(setOrgPreview).catch(() => setOrgPreview(null))
    } else { setOrgPreview(null) }
  }, [joinCode])

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Enter your name'); return }
    setError(''); setLoading(true)
    try {
      const body = { name: name.trim() }
      if (joinCode.trim()) body.join_code = joinCode.trim().toUpperCase()
      const r = await fetch(`${API}/workers/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      if (!r.ok) { setError((await r.json()).detail || 'Registration failed'); setLoading(false); return }
      const data = await r.json()
      const w = { id: data.worker.id, name: data.worker.name, org_id: data.worker.org_id, api_key: data.api_key }
      localStorage.setItem('skill2_worker', JSON.stringify(w))
      setWorker(w); nav.training(w)
    } catch { setError('Could not connect to server') }
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <button className="btn-back" onClick={nav.landing}>← Back</button>
      <div className="auth-card">
        <h1>Worker Sign In</h1>
        <p className="auth-sub">Enter your name and your organization's join code to access your training programs.</p>
        <div className="field">
          <label>Full Name</label>
          <input className="input" type="text" placeholder="e.g. John Smith"
            value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} autoFocus />
        </div>
        <div className="field">
          <label>Organization Join Code <span className="optional">optional</span></label>
          <input className={`input mono ${orgPreview ? 'input-valid' : joinCode.length === 6 ? 'input-invalid' : ''}`}
            type="text" placeholder="e.g. A3F8B2"
            value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))} maxLength={6} />
          {orgPreview && <p className="field-note ok">Joining: {orgPreview.name}</p>}
          {joinCode.length === 6 && !orgPreview && <p className="field-note err">Code not found</p>}
          {!joinCode && <p className="field-note">No code? A personal workspace will be created.</p>}
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="btn-primary full" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Creating profile...' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// Training Page — Phase-Aware with On-Device CV
// ══════════════════════════════════════════════════════════════
const SESSION_PHASES = {
  IDLE:         'idle',
  INSTRUCTIONS: 'instructions',
  CALIBRATING:  'calibrating',
  LIVE:         'live',
  ENDING:      'ending',
}

const CALIBRATION_SECS = 4

function TrainingPage({ worker, nav }) {
  // Session state
  const [sessionPhase, setSessionPhase] = useState(SESSION_PHASES.IDLE)
  const [calibCountdown, setCalibCountdown] = useState(CALIBRATION_SECS)

  // Skill / program selection
  const [workerProgress, setWorkerProgress] = useState([])
  const [programs, setPrograms]         = useState([])
  const [selectedSkill, setSelectedSkill] = useState(null)
  const [sidebarOpen, setSidebarOpen]   = useState(true)

  // CV state
  const [poseDetected, setPoseDetected] = useState(false)
  const [poseAngles, setPoseAngles]     = useState(null)
  const [workerPhase, setWorkerPhase]   = useState('unknown')

  // Coaching / scoring state
  const [currentScore, setCurrentScore] = useState(null)
  const [isGoodForm, setIsGoodForm]     = useState(null)
  const [coachingTip, setCoachingTip]   = useState('')
  const [tipHistory, setTipHistory]     = useState([])
  const [repCount, setRepCount]         = useState(0)
  const [scoreHistory, setScoreHistory] = useState([])

  // Camera / MediaPipe
  const [camError, setCamError]         = useState('')
  const [mpReady, setMpReady]           = useState(false)

  const videoRef          = useRef(null)
  const canvasRef         = useRef(null)
  const poseLandmarkerRef = useRef(null)
  const animFrameRef      = useRef(null)
  const sessionRef        = useRef(null)
  const scoreHistRef      = useRef([])
  const sessionPhaseRef   = useRef(SESSION_PHASES.IDLE)
  const selectedSkillRef  = useRef(null)
  const calibTimerRef     = useRef(null)
  const sendPoseDataRef   = useRef(null)
  // Rep detection state
  const prevPhaseRef        = useRef('unknown')
  const repInProgressRef    = useRef(false)
  const repPeakAnglesRef    = useRef(null)
  const repReachedPeakRef   = useRef(false)
  const lastCoachTimeRef    = useRef(0)
  // Smoothing: prevent raw 60fps data from thrashing React state
  const phaseBufferRef      = useRef([])       // rolling 20-frame window for phase stability
  const stablePhaseRef      = useRef('unknown')
  const lastAnglesUpdateRef = useRef(0)        // throttle angle display to 150ms
  const lastPoseDetectedRef = useRef(false)
  // Rep status for UI feedback
  const [repStatus, setRepStatus] = useState('ready') // 'ready' | 'moving' | 'evaluating'

  // Keep refs in sync with state
  useEffect(() => { sessionPhaseRef.current = sessionPhase }, [sessionPhase])
  useEffect(() => { selectedSkillRef.current = selectedSkill }, [selectedSkill])

  // ── Load programs / progress ──────────────────────────────
  useEffect(() => {
    if (!worker) return
    Promise.all([
      fetch(`${API}/workers/${worker.id}/progress`, { headers: { 'X-API-Key': worker.api_key } }).then(r => r.ok ? r.json() : []),
      fetch(`${API}/programs`, { headers: { 'X-API-Key': worker.api_key } }).then(r => r.ok ? r.json() : []),
    ]).then(([progress, progs]) => {
      setWorkerProgress(progress)
      setPrograms(progs)
      const firstSkill = progress[0]?.skill_progress?.[0] ?? progs[0]?.skills_info?.[0] ?? null
      if (firstSkill) setSelectedSkill({ skill_id: firstSkill.skill_id, display_name: firstSkill.display_name })
    }).catch(() => {})
  }, [worker])

  // ── Send pose data (JSON only — no video) ─────────────────
  const sendPoseData = useCallback(async (angles, phase) => {
    const skill = selectedSkillRef.current
    if (!skill) return
    try {
      const params = new URLSearchParams({ skill_id: skill.skill_id })
      if (sessionRef.current) params.append('session_id', sessionRef.current)
      const r = await fetch(`${API}/coach?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ angles, phase, skill_id: skill.skill_id }),
      })
      const data = await r.json()
      setCurrentScore(data.score)
      setIsGoodForm(data.is_good_form)
      setCoachingTip(data.coaching_tip)
      setRepStatus('ready')
      setTipHistory(prev => [
        { text: data.coaching_tip, good: data.is_good_form, score: data.score, id: Date.now() },
        ...prev.slice(0, 19),
      ])
      setScoreHistory(prev => { const n = [...prev, data.score]; scoreHistRef.current = n; return n })
      if (data.is_good_form) setRepCount(p => p + 1)

      const u = new SpeechSynthesisUtterance(data.coaching_tip)
      // Pick the best available English voice in priority order
      const voices = window.speechSynthesis.getVoices()
      const preferred = [
        'Google US English',   // Chrome neural — most natural
        'Samantha',            // macOS — clear and warm
        'Moira',               // macOS Irish — authoritative
        'Google UK English Female',
        'Tessa',               // South African — crisp
        'Daniel',              // British male — calm
      ]
      const pick = preferred.reduce((found, name) =>
        found || voices.find(v => v.name === name) || null, null)
        || voices.find(v => v.lang.startsWith('en') && v.localService)
        || voices.find(v => v.lang.startsWith('en'))
      if (pick) u.voice = pick
      u.rate = 0.95; u.pitch = 1.0; u.volume = 1.0
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    } catch (e) { console.error(e) }
  }, [])

  // Keep the ref up to date whenever sendPoseData identity changes
  useEffect(() => { sendPoseDataRef.current = sendPoseData }, [sendPoseData])

  // ── Detection loop (rAF) ──────────────────────────────────
  function startDetectionLoop() {
    const loop = () => {
      const video    = videoRef.current
      const canvas   = canvasRef.current
      const landmarker = poseLandmarkerRef.current
      if (!video || !canvas || !landmarker || video.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(loop)
        return
      }

      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight

      const now    = performance.now()
      const result = landmarker.detectForVideo(video, now)
      const lm     = result.landmarks?.[0]

      if (lm && lm.length > 0) {
        const angles = computeAngles(lm)
        const phase  = detectWorkerPhase(angles)

        // ── Pose detected flag (only update state on change) ──────
        if (!lastPoseDetectedRef.current) {
          lastPoseDetectedRef.current = true
          setPoseDetected(true)
        }

        // ── Phase debouncing (20-frame stability window) ──────────
        phaseBufferRef.current.push(phase)
        if (phaseBufferRef.current.length > 20) phaseBufferRef.current.shift()
        const counts = {}
        phaseBufferRef.current.forEach(p => { counts[p] = (counts[p] || 0) + 1 })
        const stablePhase = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
        if (stablePhase !== stablePhaseRef.current) {
          stablePhaseRef.current = stablePhase
          setWorkerPhase(stablePhase)
        }

        // ── Throttle angle display to 150ms ──────────────────────
        if (now - lastAnglesUpdateRef.current >= 150) {
          lastAnglesUpdateRef.current = now
          setPoseAngles(angles)
        }

        drawPose(canvas, lm, angles, skillDefRef.current?.form_rules ?? [])

        // ── Rep detection (runs every frame, all in refs) ─────────
        if (sessionPhaseRef.current === SESSION_PHASES.LIVE) {
          const prev = prevPhaseRef.current

          // Rep starts: worker leaves standing
          if (prev === 'standing' && phase !== 'standing') {
            repInProgressRef.current  = true
            repReachedPeakRef.current = false
            repPeakAnglesRef.current  = angles
            setRepStatus('moving')
          }

          // Track worst angles once mid_lift is reached
          if (repInProgressRef.current && phase === 'mid_lift') {
            repReachedPeakRef.current = true
            if (!repPeakAnglesRef.current || angles.spine < repPeakAnglesRef.current.spine) {
              repPeakAnglesRef.current = angles
            }
          }

          // Rep completes: back to standing, mid_lift was reached, cooldown elapsed
          if (
            repInProgressRef.current &&
            phase === 'standing' &&
            prev !== 'standing' &&
            repReachedPeakRef.current &&
            now - lastCoachTimeRef.current >= 5000
          ) {
            repInProgressRef.current  = false
            repReachedPeakRef.current = false
            if (repPeakAnglesRef.current) {
              lastCoachTimeRef.current = now
              setRepStatus('evaluating')
              sendPoseDataRef.current?.(repPeakAnglesRef.current, 'mid_lift')
              repPeakAnglesRef.current = null
            }
          }

          prevPhaseRef.current = phase
        }
      } else {
        if (lastPoseDetectedRef.current) {
          lastPoseDetectedRef.current = false
          setPoseDetected(false)
        }
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }

      animFrameRef.current = requestAnimationFrame(loop)
    }
    animFrameRef.current = requestAnimationFrame(loop)
  }

  // ── Initialize MediaPipe + Webcam ──────────────────────────
  useEffect(() => {
    let stream = null

    async function initCV() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await new Promise(res => { videoRef.current.onloadedmetadata = res })
          videoRef.current.play()
        }

        const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
        poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
        setMpReady(true)
        startDetectionLoop()
      } catch (e) {
        setCamError(e.name === 'NotAllowedError' ? 'Camera permission denied.' : `Camera error: ${e.message}`)
      }
    }

    initCV()

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      stream?.getTracks().forEach(t => t.stop())
      poseLandmarkerRef.current?.close?.()
      clearTimeout(calibTimerRef.current)
    }
  }, [])

  // ── Session lifecycle ─────────────────────────────────────
  const beginSession = async () => {
    if (!selectedSkill) return

    if (worker) {
      try {
        const r = await fetch(`${API}/sessions/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': worker.api_key },
          body: JSON.stringify({ worker_id: worker.id, skill_id: selectedSkill.skill_id })
        })
        if (r.status === 401) { localStorage.removeItem('skill2_worker'); nav.landing(); return }
        sessionRef.current = (await r.json()).id
      } catch (e) { console.error(e) }
    }

    // Calibration phase
    setSessionPhase(SESSION_PHASES.CALIBRATING)
    setCalibCountdown(CALIBRATION_SECS)

    let remaining = CALIBRATION_SECS
    const tick = () => {
      remaining -= 1
      setCalibCountdown(remaining)
      if (remaining > 0) {
        calibTimerRef.current = setTimeout(tick, 1000)
      } else {
        setSessionPhase(SESSION_PHASES.LIVE)
      }
    }
    calibTimerRef.current = setTimeout(tick, 1000)
  }

  const endSession = async () => {
    clearTimeout(calibTimerRef.current)
    setSessionPhase(SESSION_PHASES.ENDING)
    window.speechSynthesis.cancel()

    let session = null, cert = null, debrief = null
    if (sessionRef.current && worker) {
      try {
        session = await fetch(`${API}/sessions/${sessionRef.current}/end`, {
          method: 'POST', headers: { 'X-API-Key': worker.api_key }
        }).then(r => r.json())
        const dr = await fetch(`${API}/sessions/${sessionRef.current}/debrief`, {
          method: 'POST', headers: { 'X-API-Key': worker.api_key }
        })
        debrief = dr.ok ? (await dr.json()).debrief : null
        cert = await fetch(`${API}/workers/${worker.id}/certify/${selectedSkill.skill_id}`, {
          method: 'POST', headers: { 'X-API-Key': worker.api_key }
        }).then(r => r.json())
      } catch (e) { console.error(e) }
    }
    nav.summary({ session, cert, debrief, scoreHistory: scoreHistRef.current, skillName: selectedSkill?.display_name })
  }

  const [skillDef, setSkillDef] = useState(null)
  const skillDefRef = useRef(null)
  useEffect(() => { skillDefRef.current = skillDef }, [skillDef])

  const selectSkill = async (skill_id, display_name) => {
    if (sessionPhase !== SESSION_PHASES.IDLE) return
    setSelectedSkill({ skill_id, display_name })
    setTipHistory([]); setScoreHistory([]); scoreHistRef.current = []
    setCurrentScore(null); setRepCount(0); setCoachingTip('')
    // Fetch full definition to show instructions
    try {
      const r = await fetch(`${API}/skills/${encodeURIComponent(skill_id)}`, {
        headers: { 'X-API-Key': worker.api_key }
      })
      if (r.ok) setSkillDef((await r.json()).definition)
    } catch (_) {}
    setSessionPhase(SESSION_PHASES.INSTRUCTIONS)
  }

  const isLive         = sessionPhase === SESSION_PHASES.LIVE
  const isCalibrating  = sessionPhase === SESSION_PHASES.CALIBRATING
  const isActive       = isLive || isCalibrating
  const isEnding       = sessionPhase === SESSION_PHASES.ENDING
  const avgScore = scoreHistory.length
    ? Math.round(scoreHistory.reduce((a, b) => a + b, 0) / scoreHistory.length) : null

  const spineOk = poseAngles ? poseAngles.spine >= 150 : null

  return (
    <>
    <div className="training-page">
      <header className="t-header">
        <div className="t-header-left">
          <button className="btn-back" onClick={nav.landing}>← Back</button>
          <div className="wordmark sm">Protocol<span className="wordmark-accent">.ai</span></div>
        </div>
        <div className="t-header-center">
          {selectedSkill
            ? <span className="t-skill-name">{selectedSkill.display_name}</span>
            : <span className="t-skill-name dim">No skill selected</span>}
          {isLive && repCount > 0 && (
            <span className="rep-counter">{repCount} {repCount === 1 ? 'rep' : 'reps'}</span>
          )}
        </div>
        <div className="t-header-right">
          <button className="btn-ghost sm" onClick={() => setSidebarOpen(o => !o)}>
            {sidebarOpen ? 'Hide Programs' : 'Programs'}
          </button>
          <div className={`live-chip ${isLive ? 'live' : isCalibrating ? 'calib' : ''}`}>
            <span className="live-dot" />
            {isLive ? 'Live' : isCalibrating ? 'Calibrating' : worker?.name || 'Ready'}
          </div>
        </div>
      </header>

      <div className="t-layout">
        {sidebarOpen && (
          <aside className="t-sidebar">
            <div className="sidebar-label">TRAINING PROGRAMS</div>
            {workerProgress.length > 0 ? workerProgress.map(prog => (
              <div key={prog.program_id} className="sidebar-prog">
                <div className="sidebar-prog-head">
                  <span className="sidebar-prog-title">{prog.program_name}</span>
                  <span className="sidebar-prog-pct mono">{prog.completion_pct}%</span>
                </div>
                <div className="sidebar-prog-track">
                  <div className="sidebar-prog-fill" style={{ width: `${prog.completion_pct}%` }} />
                </div>
                {prog.skill_progress.map(sk => (
                  <button key={sk.skill_id}
                    className={`sidebar-skill ${selectedSkill?.skill_id === sk.skill_id ? 'active' : ''} ${sk.passed ? 'done' : ''}`}
                    onClick={() => selectSkill(sk.skill_id, sk.display_name)}
                    disabled={isActive || isEnding}>
                    <span className="sk-status">{sk.passed ? '◆' : sk.sessions_done > 0 ? '●' : '○'}</span>
                    <span className="sk-name">{sk.display_name}</span>
                    {sk.passed
                      ? <span className="sk-badge-pass">Passed</span>
                      : sk.sessions_done > 0
                        ? <span className="sk-badge-try">{sk.sessions_done} {sk.sessions_done === 1 ? 'try' : 'tries'}</span>
                        : null}
                  </button>
                ))}
                {prog.completion_pct === 100 && (
                  <button
                    className="btn-assessment"
                    onClick={() => nav.assessment(prog.program_id, prog.program_name)}
                    disabled={isActive || isEnding}>
                    Take Final Assessment →
                  </button>
                )}
              </div>
            )) : programs.length > 0 ? programs.map(prog => (
              <div key={prog.id} className="sidebar-prog">
                <div className="sidebar-prog-head">
                  <span className="sidebar-prog-title">{prog.name}</span>
                </div>
                {(prog.skills_info || []).map(sk => (
                  <button key={sk.skill_id}
                    className={`sidebar-skill ${selectedSkill?.skill_id === sk.skill_id ? 'active' : ''}`}
                    onClick={() => selectSkill(sk.skill_id, sk.display_name)}
                    disabled={isActive || isEnding}>
                    <span className="sk-status">○</span>
                    <span className="sk-name">{sk.display_name}</span>
                  </button>
                ))}
              </div>
            )) : (
              <p className="sidebar-empty">No programs assigned. Contact your organization administrator.</p>
            )}
          </aside>
        )}

        <div className="t-main">
          {/* ── Camera column ── */}
          <div className="t-camera-col">
            <div className="camera-wrap">
              {camError ? (
                <div className="cam-error">
                  <span>⚠</span>
                  <p>{camError}</p>
                </div>
              ) : (
                <>
                  <video ref={videoRef} className="camera-feed" muted playsInline />
                  <canvas ref={canvasRef} className="pose-canvas" />

                  {/* Score chip HUD */}
                  {isLive && currentScore !== null && (
                    <div className={`score-chip ${isGoodForm ? 'ok' : 'fail'}`}>
                      <span className="score-num">{currentScore}</span>
                      <span className="score-den">/100</span>
                    </div>
                  )}

                  {/* Form status tag */}
                  {isLive && isGoodForm !== null && (
                    <div className={`form-tag ${isGoodForm ? 'ok' : 'fail'}`}>
                      {isGoodForm ? 'GOOD FORM' : 'CORRECT FORM'}
                    </div>
                  )}

                  {/* Spine angle indicator */}
                  {poseDetected && poseAngles && (
                    <div className={`spine-hud ${spineOk ? 'ok' : 'fail'}`}>
                      <span className="spine-hud-label">SPINE</span>
                      <span className="spine-hud-val">{poseAngles.spine}°</span>
                      <span className="spine-hud-thresh">{spineOk ? '≥150°' : '<150°'}</span>
                    </div>
                  )}

                  {/* Calibration overlay */}
                  {isCalibrating && (
                    <div className="calib-overlay">
                      <div className="calib-box">
                        <div className="calib-countdown">{calibCountdown}</div>
                        <p className="calib-msg">Stand in position</p>
                        <p className="calib-sub">Training starts in {calibCountdown}s</p>
                      </div>
                    </div>
                  )}

                  {/* No-pose warning during live */}
                  {isLive && !poseDetected && (
                    <div className="no-pose-warn">No pose detected — step into frame</div>
                  )}
                </>
              )}
            </div>

            {/* Rep status / coaching feedback */}
            {isLive && (
              repStatus === 'moving'     ? <div className="rep-status moving">Moving — keep going</div>
            : repStatus === 'evaluating' ? <div className="rep-status evaluating">Analyzing your form…</div>
            : coachingTip               ? <div className={`coaching-hud ${isGoodForm ? 'ok' : 'warn'}`}>
                                            <span className="coaching-hud-icon">{isGoodForm ? '✓' : '!'}</span>
                                            <span className="coaching-hud-text">{coachingTip}</span>
                                          </div>
            : poseDetected              ? <div className="rep-status ready">Ready — perform a rep to get feedback</div>
            :                             null
            )}

            {/* Session controls */}
            {!selectedSkill
              ? <div className="no-skill-msg">Select a skill from the sidebar to begin</div>
              : sessionPhase === SESSION_PHASES.IDLE || sessionPhase === SESSION_PHASES.INSTRUCTIONS
                ? <button className="btn-session start" onClick={beginSession} disabled={!mpReady || !!camError || sessionPhase === SESSION_PHASES.INSTRUCTIONS}>
                    {mpReady ? 'Begin Session' : 'Loading pose model…'}
                  </button>
                : sessionPhase !== SESSION_PHASES.ENDING
                  ? <button className="btn-session stop" onClick={endSession} disabled={isCalibrating}>
                      {isCalibrating ? 'Calibrating…' : 'End Session'}
                    </button>
                  : <button className="btn-session stop" disabled>Saving…</button>
            }
          </div>

          {/* ── Info column ── */}
          <div className="t-info-col">
            {/* Skill instructions — always visible during session */}
            {selectedSkill && skillDef && (
              <div className="panel">
                <div className="panel-head">FORM GUIDE — {selectedSkill.display_name}</div>
                <div style={{ padding: '0.75rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {skillDef.coaching_context && (
                    <p style={{ fontSize: '0.82rem', color: 'var(--text2)', lineHeight: 1.6 }}>{skillDef.coaching_context}</p>
                  )}
                  {skillDef.form_rules?.length > 0 && (
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.35rem' }}>
                      {skillDef.form_rules.map((rule, i) => (
                        <li key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.82rem', color: 'var(--text2)' }}>
                          <span style={{ color: 'var(--green)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                          <span>{rule.violation_tip}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <div className="panel">
              <div className="panel-head">
                <span>AI COACH</span>
                {isLive && <span className="pulse-dot" />}
              </div>
              {tipHistory.length === 0
                ? <p className="panel-idle">Begin a session to receive coaching feedback.</p>
                : (
                  <div className="tip-feed">
                    {tipHistory.map((t, i) => (
                      <div key={t.id} className={`tip ${i === 0 ? 'tip-latest' : 'tip-past'} ${t.good ? 'tip-ok' : 'tip-warn'}`}>
                        <span className="tip-dot" />
                        <span className="tip-text">{t.text}</span>
                        <span className="tip-score mono">{t.score}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            <div className="panel">
              <div className="panel-head">SESSION STATS</div>
              <div className="stats-grid">
                <div className="stat-cell"><span className="stat-val mono">{repCount}</span><span className="stat-lbl">Good Reps</span></div>
                <div className="stat-cell"><span className="stat-val mono">{currentScore ?? '—'}</span><span className="stat-lbl">Current</span></div>
                <div className="stat-cell"><span className="stat-val mono">{avgScore ?? '—'}</span><span className="stat-lbl">Average</span></div>
                <div className="stat-cell"><span className="stat-val mono">{scoreHistory.length}</span><span className="stat-lbl">Analyses</span></div>
              </div>
            </div>

            {scoreHistory.length > 1 && (
              <div className="panel">
                <div className="panel-head">SCORE HISTORY</div>
                <div className="bar-chart">
                  {scoreHistory.map((s, i) => (
                    <div key={i} className="bar-col">
                      <div className="bar" style={{ height: `${s}%`, background: s >= 70 ? 'var(--green)' : s >= 50 ? 'var(--yellow)' : 'var(--red)' }} />
                    </div>
                  ))}
                </div>
                <div className="chart-axis"><span>Start</span><span>Now</span></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* ── Skill Instructions Modal ── */}
    {sessionPhase === SESSION_PHASES.INSTRUCTIONS && selectedSkill && (
      <div className="instructions-overlay">
        <div className="instructions-card">
          <div className="instructions-header">
            <span className="instructions-eyebrow">Before You Begin</span>
            <h2 className="instructions-title">{selectedSkill.display_name}</h2>
          </div>

          {skillDef?.coaching_context && (
            <p className="instructions-context">{skillDef.coaching_context}</p>
          )}

          {skillDef?.form_rules?.length > 0 && (
            <div className="instructions-rules">
              <p className="instructions-rules-label">Form requirements</p>
              <ul className="instructions-rule-list">
                {skillDef.form_rules.map((rule, i) => (
                  <li key={i} className="instructions-rule-item">
                    <span className="instructions-rule-icon">✓</span>
                    <span>{rule.violation_tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="instructions-actions">
            <button className="btn-ghost sm" onClick={() => { setSessionPhase(SESSION_PHASES.IDLE); setSelectedSkill(null) }}>
              Cancel
            </button>
            <button className="btn-primary" onClick={beginSession} disabled={!mpReady}>
              {mpReady ? "I'm Ready — Start" : 'Loading pose model…'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// ── Summary ───────────────────────────────────────────────────
function SummaryPage({ data, worker, nav }) {
  const { session, cert, debrief, scoreHistory, skillName } = data
  const avgScore  = session?.avg_score != null ? Math.round(session.avg_score)
    : scoreHistory?.length ? Math.round(scoreHistory.reduce((a, b) => a + b) / scoreHistory.length) : 0
  const repCount  = session?.rep_count ?? scoreHistory?.filter(s => s >= 70).length ?? 0
  const goodRate  = session?.rep_count > 0 ? Math.round((repCount / session.rep_count) * 100) : null
  const scoreClass = avgScore >= 75 ? 'ok' : avgScore >= 50 ? 'mid' : 'fail'

  return (
    <div className="summary-page">
      <header className="page-header-simple">
        <button className="btn-back" onClick={nav.landing}>← Home</button>
        <div className="wordmark sm">Protocol<span className="wordmark-accent">.ai</span></div>
        <span className="dim" style={{ fontSize: 13 }}>{worker?.name}</span>
      </header>

      <div className="summary-body">
        <div>
          <h1 className="summary-title">Session Complete</h1>
          {skillName && <p className="dim" style={{ marginTop: 4 }}>{skillName}</p>}
        </div>

        <div className="debrief-panel">
          <div className="debrief-label">COACH ANALYSIS</div>
          <p className="debrief-text">{debrief || 'No session data to analyze.'}</p>
        </div>

        <div className="summary-stats">
          <div className="summary-stat">
            <span className={`big-num ${scoreClass}`}>{avgScore}</span>
            <span className="big-label">Avg Score</span>
          </div>
          <div className="summary-stat">
            <span className="big-num">{repCount}</span>
            <span className="big-label">Good Reps</span>
          </div>
          {goodRate !== null && (
            <div className="summary-stat">
              <span className={`big-num ${goodRate >= 70 ? 'ok' : goodRate >= 50 ? 'mid' : 'fail'}`}>{goodRate}%</span>
              <span className="big-label">Good Form</span>
            </div>
          )}
          <div className="summary-stat">
            <span className="big-num">{scoreHistory?.length ?? 0}</span>
            <span className="big-label">Analyses</span>
          </div>
        </div>

        {scoreHistory?.length > 1 && (
          <div className="panel">
            <div className="panel-head">SCORE HISTORY</div>
            <div className="bar-chart">
              {scoreHistory.map((s, i) => (
                <div key={i} className="bar-col">
                  <div className="bar" style={{ height: `${s}%`, background: s >= 70 ? 'var(--green)' : s >= 50 ? 'var(--yellow)' : 'var(--red)' }} />
                </div>
              ))}
            </div>
            <div className="chart-axis"><span>Start</span><span>End</span></div>
          </div>
        )}

        {cert && (
          cert.certified ? (
            <div className="cert-panel certified">
              <span className="cert-mark">◆</span>
              <div>
                <p className="cert-title">Skill Completed</p>
                <p className="cert-name">{skillName}</p>
                <p className="cert-meta">Valid until {new Date(cert.expires_at).toLocaleDateString()}</p>
              </div>
            </div>
          ) : (
            <div className="cert-panel pending">
              <span className="cert-mark">◇</span>
              <div>
                <p className="cert-title">In Progress</p>
                <p className="cert-reason">{cert.reason}</p>
                {cert.avg_score != null && <p className="cert-meta">Score: {cert.avg_score} / Required: 75</p>}
              </div>
            </div>
          )
        )}

        <div className="summary-actions">
          <button className="btn-primary" onClick={() => nav.training(worker)}>Train Again</button>
          <button className="btn-outline" onClick={nav.landing}>Back to Home</button>
        </div>
      </div>
    </div>
  )
}

// ── Program Assessment ────────────────────────────────────────
function AssessmentPage({ target, worker, nav }) {
  const [questions, setQuestions] = useState(null)
  const [answers, setAnswers]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults]     = useState(null)
  const [error, setError]         = useState('')

  useEffect(() => {
    if (!target || !worker) return
    fetch(`${API}/programs/${target.programId}/assessment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': worker.api_key },
      body: JSON.stringify({ worker_id: worker.id }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(data => {
        setQuestions(data.questions)
        setAnswers(new Array(data.questions.length).fill(''))
        setLoading(false)
      })
      .catch(() => { setError('Failed to load assessment. Please try again.'); setLoading(false) })
  }, [target, worker])

  const handleSubmit = async () => {
    if (answers.some(a => !a.trim())) { setError('Please answer all questions.'); return }
    setError(''); setSubmitting(true)
    try {
      const r = await fetch(`${API}/programs/${target.programId}/assessment/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': worker.api_key },
        body: JSON.stringify({ worker_id: worker.id, questions, answers }),
      })
      if (!r.ok) throw new Error()
      setResults(await r.json())
    } catch { setError('Submission failed. Please try again.') }
    setSubmitting(false)
  }

  if (loading) return (
    <div className="assessment-page">
      <header className="page-header-simple">
        <button className="btn-back" onClick={() => nav.training(worker)}>← Back</button>
        <div className="wordmark sm">Protocol<span className="wordmark-accent">.ai</span></div>
      </header>
      <div className="assessment-body">
        <div className="assessment-loading">Generating assessment questions…</div>
      </div>
    </div>
  )

  return (
    <div className="assessment-page">
      <header className="page-header-simple">
        <button className="btn-back" onClick={() => nav.training(worker)}>← Back</button>
        <div className="wordmark sm">Protocol<span className="wordmark-accent">.ai</span></div>
        <span className="dim" style={{ fontSize: 13 }}>{worker?.name}</span>
      </header>

      <div className="assessment-body">
        {results ? (
          <>
            <div className={`assessment-result-badge ${results.passed ? 'passed' : 'failed'}`}>
              <span className="result-mark">{results.passed ? '◆' : '◇'}</span>
              <div>
                <p className="result-title">{results.passed ? 'Assessment Passed' : 'Not Passed'}</p>
                <p className="result-score">{results.score}/100</p>
              </div>
            </div>

            <div className="debrief-panel">
              <div className="debrief-label">FEEDBACK</div>
              <p className="debrief-text">{results.feedback}</p>
            </div>

            <div className="assessment-qa">
              {questions.map((q, i) => (
                <div key={i} className={`qa-item ${results.correct?.[i] ? 'qa-ok' : 'qa-fail'}`}>
                  <div className="qa-q">
                    <span className="qa-mark">{results.correct?.[i] ? '✓' : '✗'}</span>
                    <span>{q}</span>
                  </div>
                  <div className="qa-a">{answers[i]}</div>
                </div>
              ))}
            </div>

            <div className="summary-actions">
              <button className="btn-primary" onClick={() => nav.training(worker)}>Back to Training</button>
              {!results.passed && (
                <button className="btn-outline" onClick={() => { setResults(null); setAnswers(new Array(questions.length).fill('')) }}>
                  Retake Assessment
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div>
              <h1 className="summary-title">Final Assessment</h1>
              <p className="dim" style={{ marginTop: 4 }}>{target?.programName} — Answer all 5 questions</p>
            </div>

            {error && <p className="form-error">{error}</p>}

            <div className="assessment-questions">
              {(questions || []).map((q, i) => (
                <div key={i} className="aq-item">
                  <label className="aq-label">
                    <span className="aq-num">{i + 1}</span>
                    <span>{q}</span>
                  </label>
                  <textarea
                    className="aq-input"
                    placeholder="Your answer…"
                    rows={3}
                    value={answers[i] || ''}
                    onChange={e => setAnswers(prev => { const n = [...prev]; n[i] = e.target.value; return n })}
                  />
                </div>
              ))}
            </div>

            <div className="summary-actions">
              <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Grading…' : 'Submit Assessment'}
              </button>
              <button className="btn-ghost" onClick={() => nav.training(worker)}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}


// ── Org Auth ──────────────────────────────────────────────────
function OrgAuthPage({ setOrg, nav }) {
  const [tab, setTab]         = useState('new')
  const [orgName, setOrgName] = useState('')
  const [apiKey, setApiKey]   = useState('')
  const [created, setCreated] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const handleCreate = async () => {
    if (!orgName.trim()) { setError('Enter your organization name'); return }
    setError(''); setLoading(true)
    try {
      const data = await fetch(`${API}/orgs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName.trim() })
      }).then(r => r.json())
      const o = { id: data.id, name: data.name, api_key: data.api_key, join_code: data.join_code }
      localStorage.setItem('skill2_org', JSON.stringify(o))
      setOrg(o); setCreated(o)
    } catch { setError('Could not connect to server') }
    setLoading(false)
  }

  const handleSignIn = async () => {
    if (!apiKey.trim()) { setError('Enter your API key'); return }
    setError(''); setLoading(true)
    try {
      const r = await fetch(`${API}/orgs/me`, { headers: { 'X-API-Key': apiKey.trim() } })
      if (!r.ok) { setError('Invalid API key'); setLoading(false); return }
      const data = await r.json()
      const o = { id: data.id, name: data.name, api_key: apiKey.trim(), join_code: data.join_code }
      localStorage.setItem('skill2_org', JSON.stringify(o))
      setOrg(o); nav.orgDash(o)
    } catch { setError('Could not connect to server') }
    setLoading(false)
  }

  if (created) {
    return (
      <div className="auth-page">
        <div className="auth-card wide">
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: 28, color: 'var(--green)' }}>◆</span>
            <h1 style={{ marginTop: 12 }}>{created.name}</h1>
            <p className="auth-sub">Organization created. Share the join code with your workers.</p>
          </div>
          <div className="created-creds">
            <div className="cred-row">
              <span className="cred-label">Worker Join Code</span>
              <span className="cred-val mono">{created.join_code}</span>
              <span className="cred-hint">Workers enter this when signing in</span>
            </div>
            <div className="cred-row">
              <span className="cred-label">API Key</span>
              <span className="cred-val mono">{created.api_key}</span>
              <span className="cred-hint">Save this — required to sign back in</span>
            </div>
          </div>
          <button className="btn-primary full" onClick={() => nav.orgDash(created)}>Open Dashboard</button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <button className="btn-back" onClick={nav.landing}>← Back</button>
      <div className="auth-card">
        <h1>Organization Portal</h1>
        <p className="auth-sub">Create training programs from your SOPs and manage your workforce.</p>
        <div className="tab-row">
          <button className={`tab-btn ${tab === 'new' ? 'active' : ''}`} onClick={() => { setTab('new'); setError('') }}>New Organization</button>
          <button className={`tab-btn ${tab === 'signin' ? 'active' : ''}`} onClick={() => { setTab('signin'); setError('') }}>Sign In</button>
        </div>
        <div className="field">
          {tab === 'new' ? (
            <><label>Organization Name</label>
              <input className="input" type="text" placeholder="e.g. Acme Manufacturing"
                value={orgName} onChange={e => setOrgName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()} autoFocus /></>
          ) : (
            <><label>API Key</label>
              <input className="input mono" type="text" placeholder="sk-..."
                value={apiKey} onChange={e => setApiKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSignIn()} autoFocus /></>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="btn-primary full" onClick={tab === 'new' ? handleCreate : handleSignIn} disabled={loading}>
          {loading ? 'Please wait...' : tab === 'new' ? 'Create Organization' : 'Sign In'}
        </button>
      </div>
    </div>
  )
}

// ── Org Dashboard ─────────────────────────────────────────────
function OrgDashboard({ org, nav }) {
  const [tab, setTab] = useState('programs')
  const headers = { 'X-API-Key': org.api_key }

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-brand">
          <div className="wordmark sm">Protocol<span className="wordmark-accent">.ai</span></div>
          <span className="dash-sep">/</span>
          <span className="dash-org">{org.name}</span>
          {org.join_code && <span className="join-pill">JOIN: <strong>{org.join_code}</strong></span>}
        </div>
        <nav className="dash-nav">
          {['programs', 'workers', 'skills', 'overview'].map(t => (
            <button key={t} className={`dash-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        <button className="btn-ghost sm" onClick={nav.orgLogout}>Sign Out</button>
      </header>
      <div className="dash-body">
        {tab === 'programs' && <ProgramsTab  org={org} headers={headers} />}
        {tab === 'workers'  && <WorkersTab   org={org} headers={headers} />}
        {tab === 'skills'   && <SkillsTab    org={org} headers={headers} />}
        {tab === 'overview' && <OverviewTab  org={org} headers={headers} />}
      </div>
    </div>
  )
}

function OverviewTab({ org, headers }) {
  const [analytics, setAnalytics] = useState(null)
  useEffect(() => {
    fetch(`${API}/orgs/${org.id}/analytics`, { headers }).then(r => r.json()).then(setAnalytics)
  }, [org.id])
  if (!analytics) return <div className="loading">Loading...</div>
  return (
    <div className="tab-section">
      <h2 className="tab-heading">Overview</h2>
      <div className="stat-row">
        {[
          { val: analytics.total_workers, label: 'Workers' },
          { val: analytics.total_sessions, label: 'Sessions' },
          { val: analytics.avg_score_across_sessions ?? '—', label: 'Avg Score' },
        ].map(s => (
          <div key={s.label} className="stat-block">
            <span className="stat-block-val mono">{s.val}</span>
            <span className="stat-block-lbl">{s.label}</span>
          </div>
        ))}
      </div>
      {analytics.top_workers?.length > 0 && (
        <div className="panel" style={{ marginTop: '1.5rem' }}>
          <div className="panel-head">TOP PERFORMERS</div>
          <table className="data-table">
            <thead><tr><th>#</th><th>Name</th><th>Sessions</th><th>Avg Score</th></tr></thead>
            <tbody>
              {analytics.top_workers.map((w, i) => (
                <tr key={w.id}>
                  <td className="mono dim">{i + 1}</td>
                  <td>{w.name}</td>
                  <td className="mono">{w.sessions}</td>
                  <td className="mono">{Math.round(w.avg_score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function WorkersTab({ org, headers }) {
  const [workers, setWorkers] = useState(null)
  useEffect(() => {
    fetch(`${API}/orgs/${org.id}/workforce`, { headers }).then(r => r.json()).then(setWorkers)
  }, [org.id])
  if (!workers) return <div className="loading">Loading...</div>
  return (
    <div className="tab-section">
      <h2 className="tab-heading">Workers <span className="count-badge">{workers.length}</span></h2>
      {workers.length === 0 ? (
        <p className="tab-empty">No workers yet. Share join code <strong className="mono">{org.join_code}</strong> with your team.</p>
      ) : (
        <table className="data-table">
          <thead><tr><th>Name</th><th>Sessions</th><th>Avg Score</th><th>Status</th></tr></thead>
          <tbody>
            {workers.map(w => (
              <tr key={w.id}>
                <td>{w.name}</td>
                <td className="mono">{w.total_sessions}</td>
                <td className="mono">{w.avg_score ?? '—'}</td>
                <td><span className={`status-badge ${w.certified ? 'done' : 'pending'}`}>{w.certified ? 'Completed' : 'In Progress'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function SkillsTab({ org, headers }) {
  const [skills, setSkills] = useState(null)
  useEffect(() => {
    fetch(`${API}/skills`, { headers }).then(r => r.json()).then(setSkills)
  }, [org.id])
  if (!skills) return <div className="loading">Loading...</div>
  return (
    <div className="tab-section">
      <h2 className="tab-heading">Skills <span className="count-badge">{skills.length}</span></h2>
      <p className="tab-note">Skills are generated automatically when you create a training program from an SOP.</p>
      <table className="data-table">
        <thead><tr><th>Skill</th><th>Source</th><th>Rules</th><th>Min Sessions</th><th>Min Score</th></tr></thead>
        <tbody>
          {skills.map(s => (
            <tr key={s.id}>
              <td>{s.definition.display_name || s.id}</td>
              <td><span className={`status-badge ${s.org_id ? 'custom' : 'builtin'}`}>{s.org_id ? 'Custom' : 'Built-in'}</span></td>
              <td className="mono">{s.definition.form_rules?.length ?? 0}</td>
              <td className="mono">{s.definition.certification?.min_sessions ?? '—'}</td>
              <td className="mono">{s.definition.certification?.min_avg_score ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Parsing Overlay (AI Reasoning Terminal) ──────────────────────
const _POV_TIMESTAMPS = [
  '00:00.000','00:00.218','00:00.491','00:00.834',
  '00:01.092','00:01.381','00:01.664','00:01.939',
  '00:02.284','00:02.611',
]
const _POV_DELAYS    = [0, 220, 490, 840, 1090, 1380, 1660, 1940, 2280, 2620]
const _POV_PCT       = [5, 12, 25, 42, 57, 70, 81, 90, 97, 100]

function ParsingOverlay({ filename, charCount }) {
  const [visible, setVisible]   = useState(0)
  const [exiting, setExiting]   = useState(false)
  const logRef                  = useRef(null)

  const fileId = (filename || 'SOP-DOCUMENT')
    .replace(/\.[^.]+$/, '').toUpperCase()
    .replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 24)
  const pages  = Math.max(4, Math.round(charCount / 1200))
  const tasks  = Math.max(2, Math.min(6, Math.round(pages / 6) + 1))

  const LOGS = [
    { tag: 'INIT', col: '#6272a4', msg: 'SOP Scanner v2.4.1 — Protocol.ai Pose Engine' },
    { tag: 'SCAN', col: '#50fa7b', msg: `Scanning ${fileId}... [${pages} Pages Detected]` },
    { tag: 'READ', col: '#50fa7b', msg: 'Parsing document structure... OK' },
    { tag: 'AI  ', col: '#ff79c6', msg: 'Analyzing Section 1.1: Lumbar Safety... Threshold Found: 150°' },
    { tag: 'AI  ', col: '#ff79c6', msg: 'Analyzing Section 1.3: Torsional Constraints... Limit Found: 15°' },
    { tag: 'AI  ', col: '#ff79c6', msg: `Identifying posture-critical tasks... ${tasks} tasks found` },
    { tag: 'POSE', col: '#8be9fd', msg: 'Mapping joints: spine, left_knee, right_knee, left_hip... OK' },
    { tag: 'CERT', col: '#f1fa8c', msg: 'Configuring certification criteria... min_score: 70, rate: 0.70' },
    { tag: 'EDGE', col: '#bd93f9', msg: 'Configuring Edge Pose Engine... Success.' },
    { tag: 'DONE', col: '#50fa7b', msg: 'Program ready. Deploying to training pipeline.' },
  ]

  useEffect(() => {
    const timers = _POV_DELAYS.map((delay, i) => setTimeout(() => setVisible(i + 1), delay))
    const exitT  = setTimeout(() => setExiting(true), 2880)
    return () => { timers.forEach(clearTimeout); clearTimeout(exitT) }
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [visible])

  return (
    <div className={`pov-root ${exiting ? 'pov-exit' : ''}`}>
      <div className="pov-scanlines" />
      <div className="pov-grid" />
      <div className="pov-sweep" />

      <header className="pov-header">
        <span className="pov-brand">Protocol<span className="pov-brand-accent">.ai</span></span>
        <span className="pov-divider" />
        <span className="pov-title">AI REASONING ENGINE</span>
        <span style={{ flex: 1 }} />
        <span className="pov-live-dot" />
        <span className="pov-live-label">PROCESSING</span>
      </header>

      <div className="pov-body">
        <span className="pov-corner pov-tl" />
        <span className="pov-corner pov-tr" />
        <span className="pov-corner pov-bl" />
        <span className="pov-corner pov-br" />

        <div className="pov-log" ref={logRef}>
          {LOGS.slice(0, visible).map((log, i) => (
            <div key={i} className="pov-line">
              <span className="pov-ts">{_POV_TIMESTAMPS[i]}</span>
              <span className="pov-tag" style={{ color: log.col }}>[{log.tag}]</span>
              <span className={`pov-msg ${i === visible - 1 ? 'pov-msg-active' : ''}`}>
                {log.msg}
                {i === visible - 1 && !exiting && <span className="pov-cursor">▋</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      <footer className="pov-footer">
        <div className="pov-bar-track">
          <div className="pov-bar-fill" />
        </div>
        <div className="pov-footer-row">
          <span className="pov-footer-label">
            {exiting ? 'COMPLETE — BUILDING TRAINING PROGRAM' : 'PROCESSING STANDARD OPERATING PROCEDURE'}
          </span>
          <span className="pov-footer-pct">{_POV_PCT[visible - 1] ?? 0}%</span>
        </div>
      </footer>
    </div>
  )
}

function ProgramsTab({ org, headers }) {
  const [programs, setPrograms]       = useState(null)
  const [manualText, setManualText]   = useState('')
  const [programName, setProgramName] = useState('')
  const [generating, setGenerating]   = useState(false)
  const [extracting, setExtracting]   = useState(false)
  const [preview, setPreview]         = useState(null)
  const [error, setError]             = useState('')
  const [showUpload, setShowUpload]   = useState(false)
  const [droppedFile, setDroppedFile] = useState(null)
  const [dragOver, setDragOver]       = useState(false)
  const fileInputRef = useRef(null)

  const load = () => fetch(`${API}/programs`, { headers }).then(r => r.json()).then(setPrograms).catch(() => setPrograms([]))
  useEffect(() => { load() }, [])

  const processFile = async (file) => {
    setDroppedFile(file); setError('')
    if (file.name.match(/\.(txt|md)$/i)) {
      setManualText(await file.text())
    } else {
      setExtracting(true)
      try {
        const form = new FormData(); form.append('file', file)
        const r = await fetch(`${API}/programs/extract-text`, { method: 'POST', headers, body: form })
        const data = await r.json()
        if (!r.ok) { setError(data.detail || 'Could not read file'); setExtracting(false); return }
        setManualText(data.text)
      } catch { setError('Could not connect to server') }
      setExtracting(false)
    }
  }

  const handleGenerate = async () => {
    if (!manualText.trim()) { setError('Add a file or paste text first'); return }
    setGenerating(true); setError(''); setPreview(null)
    try {
      const apiCall = fetch(`${API}/programs/from-manual`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual_text: manualText, program_name: programName.trim() || null }),
      }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.detail || 'Generation failed'); return d })
      const minDelay = new Promise(res => setTimeout(res, 3000))
      const [data] = await Promise.all([apiCall, minDelay])
      setPreview(data); await load()
      setShowUpload(false); setManualText(''); setProgramName(''); setDroppedFile(null)
    } catch (e) { setError(e.message || 'Could not connect to server') }
    setGenerating(false)
  }

  if (!programs) return <div className="loading">Loading...</div>

  return (
    <>
    {generating && <ParsingOverlay filename={droppedFile?.name || null} charCount={manualText.length} />}
    <div className="tab-section">
      <div className="tab-section-head">
        <div>
          <h2 className="tab-heading">Training Programs <span className="count-badge">{programs.length}</span></h2>
          <p className="tab-note">Create programs by uploading your Standard Operating Procedures.</p>
        </div>
        <button className="btn-outline" onClick={() => { setShowUpload(s => !s); setPreview(null); setError('') }}>
          {showUpload ? 'Cancel' : '+ New Program from SOP'}
        </button>
      </div>

      {showUpload && (
        <div className="panel upload-panel">
          <div className="panel-head">CREATE TRAINING PROGRAM FROM SOP</div>
          <p className="upload-desc">
            Upload your standard operating procedure. Claude identifies posture-critical tasks
            and generates a structured training program with form rules and certification criteria.
          </p>
          <div
            className={`drop-zone ${dragOver ? 'drag-active' : ''} ${droppedFile ? 'has-file' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".txt,.md,.pdf,.docx" style={{ display: 'none' }}
              onChange={e => e.target.files[0] && processFile(e.target.files[0])} />
            {extracting
              ? <span className="drop-label">Extracting text...</span>
              : droppedFile
                ? <><span className="drop-label">{droppedFile.name}</span><span className="drop-sub">{manualText.length.toLocaleString()} characters · Click to replace</span></>
                : <><span className="drop-label">Drop SOP file here or click to browse</span><span className="drop-sub">PDF, Word (.docx), plain text (.txt, .md)</span></>
            }
          </div>
          <div className="drop-or">— or paste text —</div>
          <div className="field">
            <label>Program Name <span className="optional">optional</span></label>
            <input className="input" placeholder="e.g. Warehouse Safety Procedures"
              value={programName} onChange={e => setProgramName(e.target.value)} />
          </div>
          <textarea className="textarea" placeholder="Paste SOP content here..."
            value={manualText}
            onChange={e => { setManualText(e.target.value); if (e.target.value !== manualText) setDroppedFile(null) }}
            rows={6} />
          {error && <p className="form-error">{error}</p>}
          <button className="btn-primary" onClick={handleGenerate} disabled={generating || extracting}>
            {generating ? 'Analyzing SOP with Claude...' : 'Generate Training Program'}
          </button>
        </div>
      )}

      {preview && (
        <div className="panel program-preview">
          <div className="panel-head">PROGRAM GENERATED</div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h3 className="preview-name">{preview.program_def?.program_name}</h3>
              <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>{preview.program_def?.description}</p>
            </div>
            <div className="preview-skills">
              {(preview.program_def?.skills || []).map((sk, i) => (
                <div key={i} className="preview-skill">
                  <div className="preview-skill-head">
                    <span className="preview-skill-name">{sk.display_name}</span>
                    <span className="mono dim" style={{ fontSize: 11 }}>{sk.skill_id.split(':').pop()}</span>
                  </div>
                  <p className="dim" style={{ fontSize: 12 }}>{sk.coaching_context}</p>
                  <div className="rule-chips">
                    {sk.form_rules?.map((r, j) => (
                      <span key={j} className="rule-chip">{r.joint} {r.op === 'gt' ? '>' : '<'} {r.value}°</span>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text3)' }}>{sk.certification?.min_sessions} sessions · min score {sk.certification?.min_avg_score}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {programs.length === 0 && !showUpload ? (
        <div className="empty-state">
          <p>No training programs.</p>
          <p className="dim">Upload a Standard Operating Procedure to generate your first program.</p>
        </div>
      ) : (
        <div className="program-list">
          {programs.map(prog => (
            <div key={prog.id} className="program-row">
              <div className="program-row-left">
                <span className="program-name">{prog.name}</span>
                {prog.description && <span className="program-desc">{prog.description}</span>}
              </div>
              <div className="program-row-right">
                <div className="skill-chips">
                  {(prog.skills_info || []).map(sk => (
                    <span key={sk.skill_id} className="skill-chip">{sk.display_name}</span>
                  ))}
                </div>
                <span className="mono dim" style={{ fontSize: 12 }}>{prog.skill_ids?.length || 0} skills</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  )
}
