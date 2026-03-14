import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const API = 'http://localhost:8000'

// ── Router ────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]           = useState('landing')
  const [worker, setWorker]       = useState(null)
  const [org, setOrg]             = useState(null)
  const [summaryData, setSummary] = useState(null)

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
    landing:     ()  => setPage('landing'),
    workerAuth:  ()  => setPage('worker-auth'),
    training:    (w) => { setWorker(w); setPage('training') },
    summary:     (d) => { setSummary(d); setPage('summary') },
    orgAuth:     ()  => setPage('org-auth'),
    orgDash:     (o) => { setOrg(o); setPage('org-dashboard') },
    workerLogout: () => { localStorage.removeItem('skill2_worker'); setWorker(null); setPage('landing') },
    orgLogout:    () => { localStorage.removeItem('skill2_org');    setOrg(null);    setPage('landing') },
  }

  if (page === 'landing')       return <LandingPage    worker={worker} nav={nav} />
  if (page === 'worker-auth')   return <WorkerAuthPage setWorker={setWorker} nav={nav} />
  if (page === 'training')      return <TrainingPage   worker={worker} nav={nav} />
  if (page === 'summary')       return <SummaryPage    data={summaryData} worker={worker} nav={nav} />
  if (page === 'org-auth')      return <OrgAuthPage    setOrg={setOrg} nav={nav} />
  if (page === 'org-dashboard') return <OrgDashboard   org={org} nav={nav} />
  return null
}

// ── Landing Page ──────────────────────────────────────────────
function LandingPage({ worker, nav }) {
  return (
    <div className="landing">
      <div className="landing-grid-bg" />

      <header className="landing-header">
        <div className="landing-logo">
          <span className="landing-logo-mark">🏗️</span>
          <span className="landing-logo-text">Skill<span className="accent">²</span></span>
        </div>
        <button className="ghost-btn" onClick={nav.orgAuth}>For Organizations →</button>
      </header>

      <main className="landing-hero">
        <div className="hero-badge">
          <span className="hero-badge-dot" />
          AI-Powered · Real-Time · Verified Progress
        </div>

        <h1 className="hero-title">
          Train smarter.<br />
          Track <span className="accent">progress</span>.
        </h1>

        <p className="hero-subtitle">
          Real-time AI coaching watches your form, guides every rep, and tracks
          completion across your organisation's training programs.
        </p>

        {worker ? (
          <div className="hero-returning">
            <p className="hero-welcome-label">Welcome back</p>
            <p className="hero-welcome-name">{worker.name}</p>
            <button className="hero-cta" onClick={() => nav.training(worker)}>
              Continue Training <span>→</span>
            </button>
            <button className="text-btn" onClick={nav.workerLogout}>Not you?</button>
          </div>
        ) : (
          <button className="hero-cta" onClick={nav.workerAuth}>
            Get Started Free <span>→</span>
          </button>
        )}

        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-num">11</span>
            <span className="hero-stat-label">joints tracked</span>
          </div>
          <div className="hero-stat-divider" />
          <div className="hero-stat">
            <span className="hero-stat-num">2s</span>
            <span className="hero-stat-label">feedback cycle</span>
          </div>
          <div className="hero-stat-divider" />
          <div className="hero-stat">
            <span className="hero-stat-num">AI</span>
            <span className="hero-stat-label">powered by Claude</span>
          </div>
        </div>
      </main>

      <div className="feature-cards">
        <div className="feature-card">
          <span className="feature-card-icon">👁️</span>
          <h3>Real-Time Analysis</h3>
          <p>MediaPipe tracks 11 joint angles 30× per second. Claude evaluates your form every 2 seconds.</p>
        </div>
        <div className="feature-card">
          <span className="feature-card-icon">🎙️</span>
          <h3>Voice Coaching</h3>
          <p>Your AI coach speaks corrections aloud — no need to look at a screen while you train.</p>
        </div>
        <div className="feature-card">
          <span className="feature-card-icon">✦</span>
          <h3>Program Completion</h3>
          <p>Complete training programs set by your organisation and build a verified record of your progress.</p>
        </div>
      </div>

      <footer className="landing-footer">
        Skill² Tradeguard · Hackathon 2025
      </footer>
    </div>
  )
}

// ── Worker Auth Page ──────────────────────────────────────────
function WorkerAuthPage({ setWorker, nav }) {
  const [name, setName]           = useState('')
  const [joinCode, setJoinCode]   = useState('')
  const [orgPreview, setOrgPreview] = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    if (joinCode.length === 6) {
      fetch(`${API}/orgs/join/${joinCode.toUpperCase()}`)
        .then(r => r.ok ? r.json() : null)
        .then(setOrgPreview)
        .catch(() => setOrgPreview(null))
    } else {
      setOrgPreview(null)
    }
  }, [joinCode])

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Enter your name'); return }
    setError(''); setLoading(true)
    try {
      const body = { name: name.trim() }
      if (joinCode.trim()) body.join_code = joinCode.trim().toUpperCase()
      const r = await fetch(`${API}/workers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!r.ok) { setError((await r.json()).detail || 'Registration failed'); setLoading(false); return }
      const data = await r.json()
      const w = { id: data.worker.id, name: data.worker.name, org_id: data.worker.org_id, api_key: data.api_key }
      localStorage.setItem('skill2_worker', JSON.stringify(w))
      setWorker(w)
      nav.training(w)
    } catch { setError('Could not connect to server') }
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <button className="auth-back" onClick={nav.landing}>← Back</button>
      <div className="auth-card">
        <div className="auth-card-header">
          <span className="auth-card-icon">👷</span>
          <h1>Create Your Profile</h1>
          <p>Enter your name to start training. Have a company join code? Enter it to link your account.</p>
        </div>

        <div className="auth-form">
          <div className="auth-field">
            <label>Your Name</label>
            <input className="auth-input" type="text" placeholder="e.g. John Smith"
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()} autoFocus />
          </div>

          <div className="auth-field">
            <label>Company Join Code <span className="label-optional">optional</span></label>
            <input
              className={`auth-input join-code-input ${orgPreview ? 'is-valid' : joinCode.length === 6 ? 'is-invalid' : ''}`}
              type="text" placeholder="e.g. A3F8B2"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
              maxLength={6}
            />
            {orgPreview && <p className="field-hint success">✓ Joining {orgPreview.name}</p>}
            {joinCode.length === 6 && !orgPreview && <p className="field-hint error">✕ Code not found</p>}
            {!joinCode && <p className="field-hint">Don't have a code? No problem — we'll create a personal workspace.</p>}
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Creating profile...' : 'Start Training →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Training Page ─────────────────────────────────────────────
function TrainingPage({ worker, nav }) {
  const [isTraining, setIsTraining]   = useState(false)
  const [ending, setEnding]           = useState(false)
  const [currentScore, setCurrentScore] = useState(null)
  const [isGoodForm, setIsGoodForm]   = useState(null)
  const [tipHistory, setTipHistory]   = useState([])
  const [repCount, setRepCount]       = useState(0)
  const [scoreHistory, setScoreHistory] = useState([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [workerProgress, setWorkerProgress] = useState([])
  const [programs, setPrograms]       = useState([])
  const [selectedSkill, setSelectedSkill] = useState({ skill_id: 'lifting', display_name: 'Safe Lifting Technique' })
  const intervalRef    = useRef(null)
  const sessionRef     = useRef(null)
  const scoreHistRef   = useRef([])
  const tipListRef     = useRef(null)

  useEffect(() => {
    if (worker) {
      fetch(`${API}/workers/${worker.id}/progress`, { headers: { 'X-API-Key': worker.api_key } })
        .then(r => r.ok ? r.json() : []).then(setWorkerProgress).catch(() => {})
      fetch(`${API}/programs`, { headers: { 'X-API-Key': worker.api_key } })
        .then(r => r.ok ? r.json() : []).then(setPrograms).catch(() => {})
    }
  }, [worker])

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  const captureAndSend = useCallback(async () => {
    try {
      const params = new URLSearchParams({ skill_id: selectedSkill.skill_id })
      if (sessionRef.current) params.append('session_id', sessionRef.current)
      const r = await fetch(`${API}/coach?${params}`, { method: 'POST' })
      const data = await r.json()
      setCurrentScore(data.score)
      setIsGoodForm(data.is_good_form)
      setTipHistory(prev => [{ text: data.coaching_tip, good: data.is_good_form, score: data.score, id: Date.now() }, ...prev.slice(0, 19)])
      setScoreHistory(prev => { const n = [...prev, data.score]; scoreHistRef.current = n; return n })
      if (data.is_good_form) setRepCount(p => p + 1)
      const u = new SpeechSynthesisUtterance(data.coaching_tip)
      u.rate = 1.05; u.pitch = 1.0
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    } catch (e) { console.error(e) }
  }, [selectedSkill.skill_id])

  const beginSession = async () => {
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
    setIsTraining(true)
    intervalRef.current = setInterval(captureAndSend, 2000)
  }

  const endSession = async () => {
    clearInterval(intervalRef.current)
    setIsTraining(false)
    setEnding(true)
    window.speechSynthesis.cancel()
    let session = null, cert = null, debrief = null
    if (sessionRef.current && worker) {
      try {
        session = await fetch(`${API}/sessions/${sessionRef.current}/end`, {
          method: 'POST', headers: { 'X-API-Key': worker.api_key }
        }).then(r => r.json())
        const debriefRes = await fetch(`${API}/sessions/${sessionRef.current}/debrief`, {
          method: 'POST', headers: { 'X-API-Key': worker.api_key }
        })
        debrief = debriefRes.ok ? (await debriefRes.json()).debrief : null
        cert = await fetch(`${API}/workers/${worker.id}/certify/${selectedSkill.skill_id}`, {
          method: 'POST', headers: { 'X-API-Key': worker.api_key }
        }).then(r => r.json())
      } catch (e) { console.error(e) }
    }
    setEnding(false)
    nav.summary({ session, cert, debrief, scoreHistory: scoreHistRef.current, skillName: selectedSkill.display_name })
  }

  const selectSkill = (skill_id, display_name) => {
    if (isTraining) return
    setSelectedSkill({ skill_id, display_name })
    setTipHistory([]); setScoreHistory([]); scoreHistRef.current = []
    setCurrentScore(null); setRepCount(0)
  }

  const avgScore = scoreHistory.length
    ? Math.round(scoreHistory.reduce((a, b) => a + b, 0) / scoreHistory.length)
    : 0

  const displayPrograms = workerProgress.length > 0 ? null : programs

  return (
    <div className="training-page">
      <header className="page-header">
        <button className="ghost-btn" onClick={nav.landing}>← Back</button>
        <h1 className="page-title">{selectedSkill.display_name} <span className="accent">Training</span></h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className={`ghost-btn ${sidebarOpen ? 'sidebar-btn-active' : ''}`} onClick={() => setSidebarOpen(o => !o)}>
            ☰ Programs
          </button>
          <div className={`live-badge ${isTraining ? 'live' : ''}`}>
            <span className="live-dot" />
            {isTraining ? 'Live' : worker?.name || 'Ready'}
          </div>
        </div>
      </header>

      <div className={`training-layout ${sidebarOpen ? 'sidebar-open' : ''}`}>
        {sidebarOpen && (
          <aside className="programs-sidebar">
            <div className="sidebar-scroll">
              {workerProgress.length > 0 && workerProgress.map(prog => (
                <div key={prog.program_id} className="sidebar-program">
                  <div className="sidebar-prog-header">
                    <span className="sidebar-prog-name">{prog.program_name}</span>
                    <span className="sidebar-prog-pct">{prog.completion_pct}%</span>
                  </div>
                  <div className="sidebar-prog-bar">
                    <div className="sidebar-prog-fill" style={{ width: `${prog.completion_pct}%` }} />
                  </div>
                  <div className="sidebar-skills">
                    {prog.skill_progress.map(sk => (
                      <button key={sk.skill_id}
                        className={`sidebar-skill ${selectedSkill.skill_id === sk.skill_id ? 'selected' : ''} ${sk.certified ? 'certified' : ''}`}
                        onClick={() => selectSkill(sk.skill_id, sk.display_name)}
                        disabled={isTraining}>
                        <span className="sk-icon">{sk.certified ? '✦' : sk.sessions_done > 0 ? '●' : '○'}</span>
                        <span className="sk-name">{sk.display_name}</span>
                        <span className="sk-prog">{sk.sessions_done}/{sk.sessions_needed}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {displayPrograms && displayPrograms.length > 0 && displayPrograms.map(prog => (
                <div key={prog.id} className="sidebar-program">
                  <div className="sidebar-prog-header">
                    <span className="sidebar-prog-name">{prog.name}</span>
                  </div>
                  <div className="sidebar-skills">
                    {(prog.skills_info || []).map(sk => (
                      <button key={sk.skill_id}
                        className={`sidebar-skill ${selectedSkill.skill_id === sk.skill_id ? 'selected' : ''}`}
                        onClick={() => selectSkill(sk.skill_id, sk.display_name)}
                        disabled={isTraining}>
                        <span className="sk-icon">○</span>
                        <span className="sk-name">{sk.display_name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="sidebar-program">
                <div className="sidebar-prog-header">
                  <span className="sidebar-prog-name">Built-in Skills</span>
                </div>
                <div className="sidebar-skills">
                  <button
                    className={`sidebar-skill ${selectedSkill.skill_id === 'lifting' ? 'selected' : ''}`}
                    onClick={() => selectSkill('lifting', 'Safe Lifting Technique')}
                    disabled={isTraining}>
                    <span className="sk-icon">○</span>
                    <span className="sk-name">Safe Lifting Technique</span>
                  </button>
                </div>
              </div>

              {workerProgress.length === 0 && programs.length === 0 && (
                <p className="sidebar-hint">No training programs yet. Your organization can create them from the dashboard.</p>
              )}
            </div>
          </aside>
        )}

        <div className="training-grid">
          <div className="camera-col">
            <div className="camera-wrap">
              <img src={`${API}/video`} className="camera-feed" alt="pose" />
              {currentScore !== null && isTraining && (
                <div className={`score-overlay ${isGoodForm ? 'good' : 'bad'}`}>
                  <span className="score-big">{currentScore}</span>
                  <span className="score-denom">/100</span>
                </div>
              )}
              {isTraining && isGoodForm !== null && (
                <div className={`form-pill ${isGoodForm ? 'good' : 'bad'}`}>
                  {isGoodForm ? '✓ Good Form' : '✗ Fix Form'}
                </div>
              )}
            </div>
            {!isTraining
              ? <button className="session-btn start" onClick={beginSession} disabled={ending}>▶ Begin Session</button>
              : <button className="session-btn stop" onClick={endSession} disabled={ending}>{ending ? 'Saving...' : '■ End Session'}</button>
            }
          </div>

          <div className="info-col">
            <div className="panel coach-panel">
              <div className="panel-label">
                <span>🎯</span><span>AI Coach</span>
                {isTraining && <span className="thinking-dots"><span /><span /><span /></span>}
              </div>
              {tipHistory.length === 0
                ? <p className="coach-idle">Press Begin Session to start receiving coaching.</p>
                : (
                  <div className="tip-feed" ref={tipListRef}>
                    {tipHistory.map((t, i) => (
                      <div key={t.id} className={`tip-item ${i === 0 ? 'tip-latest' : 'tip-old'} ${t.good ? 'tip-good' : 'tip-warn'}`}>
                        <span className={`tip-dot ${t.good ? 'good' : 'warn'}`} />
                        <span className="tip-text">{t.text}</span>
                        <span className="tip-score">{t.score}</span>
                      </div>
                    ))}
                  </div>
                )
              }
            </div>

            <div className="panel stats-panel">
              <div className="panel-label"><span>📊</span><span>Session Stats</span></div>
              <div className="stats-grid">
                <div className="stat"><span className="stat-val">{repCount}</span><span className="stat-lbl">Good Reps</span></div>
                <div className="stat"><span className="stat-val">{currentScore ?? '—'}</span><span className="stat-lbl">Current</span></div>
                <div className="stat"><span className="stat-val">{avgScore || '—'}</span><span className="stat-lbl">Avg Score</span></div>
                <div className="stat"><span className="stat-val">{scoreHistory.length}</span><span className="stat-lbl">Analyses</span></div>
              </div>
            </div>

            {scoreHistory.length > 1 && (
              <div className="panel chart-panel">
                <div className="panel-label"><span>📈</span><span>Progress</span></div>
                <div className="bar-chart">
                  {scoreHistory.map((s, i) => (
                    <div key={i} className="bar-wrap" title={`Rep ${i + 1}: ${s}`}>
                      <div className="bar" style={{ height: `${s}%`, background: s >= 70 ? 'var(--accent)' : s >= 50 ? 'var(--warning)' : 'var(--danger)' }} />
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
  )
}

// ── Summary Page ──────────────────────────────────────────────
function SummaryPage({ data, worker, nav }) {
  const { session, cert, debrief, scoreHistory } = data
  const avgScore  = session?.avg_score != null ? Math.round(session.avg_score) : scoreHistory.length ? Math.round(scoreHistory.reduce((a, b) => a + b) / scoreHistory.length) : 0
  const repCount  = session?.rep_count ?? scoreHistory.filter(s => s >= 70).length
  const goodRate  = session && session.rep_count > 0 ? Math.round((repCount / session.rep_count) * 100) : null
  const scoreClass = avgScore >= 75 ? 'good' : avgScore >= 50 ? 'ok' : 'bad'

  return (
    <div className="summary-page">
      <header className="page-header">
        <button className="ghost-btn" onClick={nav.landing}>← Home</button>
        <h1 className="page-title">Session <span className="accent">Summary</span></h1>
        <div className="live-badge">{worker?.name}</div>
      </header>

      <div className="summary-body">

        {/* AI Debrief — hero section */}
        <div className="debrief-card">
          <div className="debrief-header">
            <span className="debrief-icon">🤖</span>
            <span className="debrief-label">Coach Analysis</span>
          </div>
          {debrief
            ? <p className="debrief-text">{debrief}</p>
            : <p className="debrief-text muted">No session data to analyze.</p>
          }
        </div>

        {/* Score row */}
        <div className="summary-stats-row">
          <div className="summary-stat-big">
            <span className={`summary-score ${scoreClass}`}>{avgScore}</span>
            <span className="summary-score-denom">/100</span>
            <span className="summary-stat-label">Avg Score</span>
          </div>
          <div className="summary-stat-big">
            <span className="summary-score neutral">{repCount}</span>
            <span className="summary-stat-label">Good Reps</span>
          </div>
          {goodRate !== null && (
            <div className="summary-stat-big">
              <span className={`summary-score ${goodRate >= 70 ? 'good' : goodRate >= 50 ? 'ok' : 'bad'}`}>{goodRate}%</span>
              <span className="summary-stat-label">Good Form</span>
            </div>
          )}
          <div className="summary-stat-big">
            <span className="summary-score neutral">{scoreHistory.length}</span>
            <span className="summary-stat-label">Analyses</span>
          </div>
        </div>

        {/* Chart */}
        {scoreHistory.length > 1 && (
          <div className="panel">
            <div className="panel-label"><span>📈</span><span>Score History</span></div>
            <div className="bar-chart">
              {scoreHistory.map((s, i) => (
                <div key={i} className="bar-wrap">
                  <div className="bar" style={{
                    height: `${s}%`,
                    background: s >= 70 ? 'var(--accent)' : s >= 50 ? 'var(--warning)' : 'var(--danger)'
                  }} />
                </div>
              ))}
            </div>
            <div className="chart-axis"><span>Start</span><span>End</span></div>
          </div>
        )}

        {/* Completion status */}
        {cert && (
          cert.certified ? (
            <div className="cert-card certified">
              <div className="cert-card-left">
                <span className="cert-star">✦</span>
                <div>
                  <h3>Skill Completed</h3>
                  <p>{cert.skill_id || 'Training Skill'}</p>
                  <p className="cert-meta">Completed by {worker?.name} · Valid until {new Date(cert.expires_at).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="cert-card pending">
              <div className="cert-card-left">
                <span className="cert-star dim">◎</span>
                <div>
                  <h3>In Progress</h3>
                  <p className="cert-reason">{cert.reason}</p>
                  {cert.avg_score != null && <p className="cert-meta">Your avg: {cert.avg_score} · Required: 75</p>}
                </div>
              </div>
            </div>
          )
        )}

        <div className="summary-actions">
          <button className="hero-cta" onClick={() => nav.training(worker)}>Train Again →</button>
          <button className="ghost-btn large" onClick={nav.landing}>Back to Home</button>
        </div>
      </div>
    </div>
  )
}

// ── Org Auth Page ─────────────────────────────────────────────
function OrgAuthPage({ setOrg, nav }) {
  const [tab, setTab]       = useState('new')
  const [orgName, setOrgName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [created, setCreated] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  const handleCreate = async () => {
    if (!orgName.trim()) { setError('Enter your organization name'); return }
    setError(''); setLoading(true)
    try {
      const data = await fetch(`${API}/orgs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName.trim() })
      }).then(r => r.json())
      const o = { id: data.id, name: data.name, api_key: data.api_key, join_code: data.join_code }
      localStorage.setItem('skill2_org', JSON.stringify(o))
      setOrg(o)
      setCreated(o)
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
      setOrg(o)
      nav.orgDash(o)
    } catch { setError('Could not connect to server') }
    setLoading(false)
  }

  if (created) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-card-header">
            <span className="auth-card-icon success">✓</span>
            <h1>{created.name}</h1>
            <p>Your organization is ready. Share the join code with your workers.</p>
          </div>
          <div className="created-details">
            <div className="join-code-display">
              <span className="join-code-label">Worker Join Code</span>
              <span className="join-code-value">{created.join_code}</span>
              <span className="join-code-hint">Workers enter this to link their account to your org</span>
            </div>
            <div className="api-key-display">
              <span className="api-key-label">API Key</span>
              <span className="api-key-value">{created.api_key}</span>
              <span className="join-code-hint">Save this — use it to sign back in</span>
            </div>
          </div>
          <button className="auth-submit" onClick={() => nav.orgDash(created)}>
            Open Dashboard →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <button className="auth-back" onClick={nav.landing}>← Back</button>
      <div className="auth-card">
        <div className="auth-card-header">
          <span className="auth-card-icon">🏢</span>
          <h1>Organization Portal</h1>
          <p>Manage your workforce, register skills, and track training progress.</p>
        </div>

        <div className="tab-row">
          <button className={`tab-btn ${tab === 'new' ? 'active' : ''}`} onClick={() => { setTab('new'); setError('') }}>New Organization</button>
          <button className={`tab-btn ${tab === 'signin' ? 'active' : ''}`} onClick={() => { setTab('signin'); setError('') }}>Sign In</button>
        </div>

        <div className="auth-form">
          {tab === 'new' ? (
            <div className="auth-field">
              <label>Organization Name</label>
              <input className="auth-input" type="text" placeholder="e.g. Acme Warehousing"
                value={orgName} onChange={e => setOrgName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()} autoFocus />
            </div>
          ) : (
            <div className="auth-field">
              <label>API Key</label>
              <input className="auth-input" type="text" placeholder="sk-..."
                value={apiKey} onChange={e => setApiKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSignIn()} autoFocus />
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" onClick={tab === 'new' ? handleCreate : handleSignIn} disabled={loading}>
            {loading ? 'Please wait...' : tab === 'new' ? 'Create Organization →' : 'Sign In →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Org Dashboard ─────────────────────────────────────────────
function OrgDashboard({ org, nav }) {
  const [tab, setTab] = useState('overview')
  const headers = { 'X-API-Key': org.api_key }

  return (
    <div className="dashboard">
      <header className="page-header">
        <div className="dash-brand">
          <span>🏢</span>
          <span className="dash-org-name">{org.name}</span>
          {org.join_code && (
            <div className="join-code-pill">
              <span>Join code</span>
              <strong>{org.join_code}</strong>
            </div>
          )}
        </div>
        <nav className="dash-tabs">
          {['overview', 'workers', 'skills', 'programs'].map(t => (
            <button key={t} className={`dash-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        <button className="ghost-btn" onClick={nav.orgLogout}>Sign Out</button>
      </header>

      <div className="dash-body">
        {tab === 'overview' && <OverviewTab org={org} headers={headers} />}
        {tab === 'workers'  && <WorkersTab  org={org} headers={headers} />}
        {tab === 'skills'    && <SkillsTab    org={org} headers={headers} />}
        {tab === 'programs'  && <ProgramsTab  org={org} headers={headers} />}
      </div>
    </div>
  )
}

function OverviewTab({ org, headers }) {
  const [analytics, setAnalytics] = useState(null)
  useEffect(() => {
    fetch(`${API}/orgs/${org.id}/analytics`, { headers }).then(r => r.json()).then(setAnalytics)
  }, [org.id])

  if (!analytics) return <div className="dash-loading">Loading...</div>

  return (
    <div className="dash-section">
      <h2 className="dash-heading">Overview</h2>
      <div className="overview-stats">
        {[
          { val: analytics.total_workers,              label: 'Workers' },
          { val: analytics.total_sessions,             label: 'Sessions' },
          { val: analytics.avg_score_across_sessions ?? '—', label: 'Avg Score' },
        ].map(s => (
          <div key={s.label} className="overview-stat">
            <span className="overview-stat-val">{s.val}</span>
            <span className="overview-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {analytics.top_workers.length > 0 && (
        <div className="panel" style={{ marginTop: '1.5rem' }}>
          <div className="panel-label"><span>🏆</span><span>Top Performers</span></div>
          <div className="leaderboard">
            {analytics.top_workers.map((w, i) => (
              <div key={w.id} className="leaderboard-row">
                <span className="rank">#{i + 1}</span>
                <span className="lb-name">{w.name}</span>
                <span className="lb-sessions">{w.sessions} sessions</span>
                <span className="lb-score">{Math.round(w.avg_score)}</span>
              </div>
            ))}
          </div>
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

  if (!workers) return <div className="dash-loading">Loading...</div>

  return (
    <div className="dash-section">
      <h2 className="dash-heading">Workers <span className="count-pill">{workers.length}</span></h2>
      {workers.length === 0
        ? <p className="dash-empty">No workers yet. Share your join code <strong>{org.join_code}</strong> with your team.</p>
        : (
          <div className="worker-list">
            {workers.map(w => (
              <div key={w.id} className="worker-card">
                <div className="worker-card-avatar">{w.name.charAt(0).toUpperCase()}</div>
                <div className="worker-card-info">
                  <p className="worker-card-name">{w.name}</p>
                  <p className="worker-card-meta">{w.total_sessions} sessions · Avg {w.avg_score ?? '—'}</p>
                </div>
                <span className={`status-badge ${w.certified ? 'certified' : 'pending'}`}>
                  {w.certified ? '✦ Completed' : '◎ In Progress'}
                </span>
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}

function SkillsTab({ org, headers }) {
  const [skills, setSkills]   = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]       = useState({ displayName: '', skillId: '', minSessions: 3, minScore: 75, rules: [] })
  const [newRule, setNewRule] = useState({ joint: 'spine', op: 'gt', value: '', tip: '' })
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const JOINTS = ['spine', 'left_knee', 'right_knee', 'left_elbow', 'right_elbow', 'left_hip', 'right_hip', 'left_shoulder', 'right_shoulder']

  const load = () => fetch(`${API}/skills`, { headers }).then(r => r.json()).then(setSkills)
  useEffect(() => { load() }, [])

  const addRule = () => {
    if (!newRule.value || !newRule.tip) return
    setForm(f => ({ ...f, rules: [...f.rules, { ...newRule, value: parseFloat(newRule.value) }] }))
    setNewRule(r => ({ ...r, value: '', tip: '' }))
  }

  const handleRegister = async () => {
    if (!form.displayName || form.rules.length === 0) { setError('Add a name and at least one rule'); return }
    setSaving(true); setError('')
    const definition = {
      skill_id: form.skillId || form.displayName.toLowerCase().replace(/\s+/g, '_'),
      display_name: form.displayName,
      coaching_context: `coaching someone on ${form.displayName}`,
      form_rules: form.rules.map(r => ({ joint: r.joint, op: r.op, value: r.value, violation_tip: r.tip })),
      score_formula: [{ joint: form.rules[0].joint, scale: { from: [100, 180], to: [0, 100] }, weight: 1.0 }],
      certification: { min_sessions: form.minSessions, min_avg_score: form.minScore, min_good_form_rate: 0.70, cert_valid_days: 365 }
    }
    try {
      const r = await fetch(`${API}/skills`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition })
      })
      if (!r.ok) { setError('Failed to register'); setSaving(false); return }
      await load()
      setShowForm(false)
      setForm({ displayName: '', skillId: '', minSessions: 3, minScore: 75, rules: [] })
    } catch { setError('Could not connect to server') }
    setSaving(false)
  }

  if (!skills) return <div className="dash-loading">Loading...</div>

  return (
    <div className="dash-section">
      <div className="dash-section-top">
        <h2 className="dash-heading">Skills <span className="count-pill">{skills.length}</span></h2>
        <button className="outline-btn" onClick={() => setShowForm(s => !s)}>
          {showForm ? 'Cancel' : '+ Register Skill'}
        </button>
      </div>

      {showForm && (
        <div className="panel skill-form-panel">
          <div className="panel-label"><span>⚙️</span><span>New Skill Definition</span></div>
          <div className="form-grid-2">
            <div className="form-field">
              <label>Display Name</label>
              <input className="form-input" placeholder="e.g. Safe Forklift Mount"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} />
            </div>
            <div className="form-field">
              <label>Skill ID</label>
              <input className="form-input" placeholder="auto-generated"
                value={form.skillId || form.displayName.toLowerCase().replace(/\s+/g, '_')}
                onChange={e => setForm(f => ({ ...f, skillId: e.target.value }))} />
            </div>
            <div className="form-field">
              <label>Sessions to Complete</label>
              <input className="form-input" type="number" value={form.minSessions}
                onChange={e => setForm(f => ({ ...f, minSessions: parseInt(e.target.value) }))} />
            </div>
            <div className="form-field">
              <label>Min Avg Score</label>
              <input className="form-input" type="number" value={form.minScore}
                onChange={e => setForm(f => ({ ...f, minScore: parseInt(e.target.value) }))} />
            </div>
          </div>

          <div className="rules-block">
            <p className="rules-label">Form Rules</p>
            {form.rules.map((r, i) => (
              <div key={i} className="rule-chip">
                <span>{r.joint} {r.op} {r.value}° — "{r.tip}"</span>
                <button onClick={() => setForm(f => ({ ...f, rules: f.rules.filter((_, j) => j !== i) }))}>✕</button>
              </div>
            ))}
            <div className="rule-builder">
              <select className="form-select" value={newRule.joint} onChange={e => setNewRule(r => ({ ...r, joint: e.target.value }))}>
                {JOINTS.map(j => <option key={j}>{j}</option>)}
              </select>
              <select className="form-select" value={newRule.op} onChange={e => setNewRule(r => ({ ...r, op: e.target.value }))}>
                <option value="gt">&gt; greater than</option>
                <option value="lt">&lt; less than</option>
              </select>
              <input className="form-input num-input" type="number" placeholder="degrees"
                value={newRule.value} onChange={e => setNewRule(r => ({ ...r, value: e.target.value }))} />
              <input className="form-input flex-input" placeholder="Tip when violated"
                value={newRule.tip} onChange={e => setNewRule(r => ({ ...r, tip: e.target.value }))} />
              <button className="outline-btn small" onClick={addRule}>Add</button>
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" style={{ marginTop: '0.5rem', alignSelf: 'flex-start' }}
            onClick={handleRegister} disabled={saving}>
            {saving ? 'Registering...' : 'Register Skill →'}
          </button>
        </div>
      )}

      <div className="skill-list">
        {skills.map(s => (
          <div key={s.id} className="skill-card">
            <span className={`skill-type-badge ${s.org_id ? 'custom' : 'builtin'}`}>
              {s.org_id ? 'Custom' : 'Built-in'}
            </span>
            <p className="skill-card-name">{s.definition.display_name || s.id}</p>
            <p className="skill-card-meta">
              {s.definition.form_rules?.length ?? 0} rules ·
              Complete after {s.definition.certification?.min_sessions ?? '—'} sessions ·
              Min score {s.definition.certification?.min_avg_score ?? '—'}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Programs Tab ───────────────────────────────────────────────
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
    setDroppedFile(file)
    setError('')
    const name = file.name.toLowerCase()
    if (name.endsWith('.txt') || name.endsWith('.md')) {
      const text = await file.text()
      setManualText(text)
    } else {
      setExtracting(true)
      try {
        const form = new FormData()
        form.append('file', file)
        const r = await fetch(`${API}/programs/extract-text`, { method: 'POST', headers, body: form })
        const data = await r.json()
        if (!r.ok) { setError(data.detail || 'Could not read file'); setExtracting(false); return }
        setManualText(data.text)
      } catch { setError('Could not connect to server') }
      setExtracting(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleFileInput = (e) => {
    const file = e.target.files[0]
    if (file) processFile(file)
  }

  const handleGenerate = async () => {
    if (!manualText.trim()) { setError('Add a file or paste text above'); return }
    setGenerating(true); setError(''); setPreview(null)
    try {
      const r = await fetch(`${API}/programs/from-manual`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual_text: manualText, program_name: programName.trim() || null })
      })
      const data = await r.json()
      if (!r.ok) { setError(data.detail || 'Generation failed'); setGenerating(false); return }
      setPreview(data)
      await load()
      setShowUpload(false)
      setManualText('')
      setProgramName('')
      setDroppedFile(null)
    } catch { setError('Could not connect to server') }
    setGenerating(false)
  }

  if (!programs) return <div className="dash-loading">Loading...</div>

  return (
    <div className="dash-section">
      <div className="dash-section-top">
        <h2 className="dash-heading">Training Programs <span className="count-pill">{programs.length}</span></h2>
        <button className="outline-btn" onClick={() => { setShowUpload(s => !s); setPreview(null); setError(''); setDroppedFile(null); setManualText('') }}>
          {showUpload ? 'Cancel' : '+ Create from Manual'}
        </button>
      </div>

      {showUpload && (
        <div className="panel manual-upload-panel">
          <div className="panel-label"><span>📄</span><span>Create Training Program from Manual</span></div>
          <p className="upload-hint">Drop your training manual, safety document, or requirements file. Claude will extract posture-based skills and build a structured training program.</p>

          {/* Drop zone */}
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''} ${droppedFile ? 'has-file' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".txt,.md,.pdf,.docx" style={{ display: 'none' }} onChange={handleFileInput} />
            {extracting ? (
              <div className="drop-zone-content">
                <span className="drop-zone-icon">⏳</span>
                <p className="drop-zone-label">Reading file<span className="thinking-dots" style={{display:'inline-flex',marginLeft:'4px'}}><span/><span/><span/></span></p>
              </div>
            ) : droppedFile ? (
              <div className="drop-zone-content">
                <span className="drop-zone-icon">✓</span>
                <p className="drop-zone-label">{droppedFile.name}</p>
                <p className="drop-zone-sub">{manualText.length.toLocaleString()} characters extracted · Click to replace</p>
              </div>
            ) : (
              <div className="drop-zone-content">
                <span className="drop-zone-icon">📂</span>
                <p className="drop-zone-label">Drop your file here, or click to browse</p>
                <p className="drop-zone-sub">Supports PDF, Word (.docx), and plain text (.txt, .md)</p>
              </div>
            )}
          </div>

          <div className="drop-zone-divider"><span>or paste text directly</span></div>

          <div className="form-field">
            <label>Program Name <span className="label-optional">optional</span></label>
            <input className="form-input" placeholder="e.g. Warehouse Safety Program"
              value={programName} onChange={e => setProgramName(e.target.value)} />
          </div>
          <textarea
            className="manual-textarea"
            placeholder="Paste your training manual, safety requirements, or job description here..."
            value={manualText}
            onChange={e => { setManualText(e.target.value); if (e.target.value !== manualText) setDroppedFile(null) }}
            rows={6}
          />
          {error && <p className="auth-error" style={{ marginTop: '0.5rem' }}>{error}</p>}
          <button className="auth-submit" style={{ marginTop: '0.75rem', alignSelf: 'flex-start' }}
            onClick={handleGenerate} disabled={generating || extracting}>
            {generating ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Analyzing with Claude<span className="thinking-dots"><span /><span /><span /></span>
              </span>
            ) : 'Analyze & Generate Program →'}
          </button>
        </div>
      )}

      {preview && (
        <div className="panel program-preview-card">
          <div className="panel-label"><span>✦</span><span>Program Generated</span></div>
          <h3 className="preview-prog-name">{preview.program_def?.program_name}</h3>
          <p className="preview-prog-desc">{preview.program_def?.description}</p>
          <div className="preview-skills">
            {(preview.program_def?.skills || []).map((sk, i) => (
              <div key={i} className="preview-skill-card">
                <div className="preview-skill-header">
                  <span className="preview-skill-name">{sk.display_name}</span>
                  <span className="preview-skill-id">{sk.skill_id.split(':').pop()}</span>
                </div>
                <p className="preview-skill-context">{sk.coaching_context}</p>
                <div className="preview-rules">
                  {sk.form_rules?.map((r, j) => (
                    <span key={j} className="rule-chip-sm">
                      {r.joint} {r.op === 'gt' ? '>' : '<'} {r.value}°
                    </span>
                  ))}
                </div>
                <p className="preview-cert-meta">
                  Complete after {sk.certification?.min_sessions} sessions · Min score {sk.certification?.min_avg_score}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {programs.length === 0 && !showUpload ? (
        <div className="dash-empty-state">
          <span className="dash-empty-icon">📋</span>
          <p>No training programs yet.</p>
          <p className="text-muted">Upload a training manual to automatically generate a structured program with AI-defined skills.</p>
        </div>
      ) : (
        <div className="program-list">
          {programs.map(prog => (
            <div key={prog.id} className="program-card">
              <div className="program-card-header">
                <div>
                  <h3 className="program-card-name">{prog.name}</h3>
                  {prog.description && <p className="program-card-desc">{prog.description}</p>}
                </div>
                <span className="count-pill">{prog.skill_ids?.length || 0} skills</span>
              </div>
              <div className="program-skill-chips">
                {(prog.skills_info || []).map(sk => (
                  <span key={sk.skill_id} className="skill-chip">{sk.display_name}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
