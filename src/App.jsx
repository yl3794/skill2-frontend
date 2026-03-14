import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

function App() {
  const [page, setPage] = useState('landing')

  if (page === 'landing') {
    return <LandingPage onStart={() => setPage('training')} />
  }

  if (page === 'training') {
    return <TrainingPage onBack={() => setPage('landing')} />
  }

  return null
}

/* ==================== LANDING PAGE ==================== */
function LandingPage({ onStart }) {
  return (
    <div className="landing">
      <div className="landing-content">
        <div className="brand">
          <div className="logo-icon">🏗️</div>
          <h1 className="brand-name">
            Form<span className="highlight">Coach</span>
          </h1>
        </div>

        <p className="tagline">
          AI-powered training for skilled trades.
          Practice safe lifting techniques with real-time
          feedback from your personal AI coach.
        </p>

        <div className="features">
          <span className="feature-pill">
            <span className="dot"></span>Real-time correction
          </span>
          <span className="feature-pill">
            <span className="dot"></span>Pose detection
          </span>
          <span className="feature-pill">
            <span className="dot"></span>Voice coaching
          </span>
          <span className="feature-pill">
            <span className="dot"></span>Progress tracking
          </span>
        </div>

        <button className="cta-button" onClick={onStart}>
          Start Training
          <span className="arrow">→</span>
        </button>
      </div>

      <div className="bottom-bar">
        <span className="status-dot">System ready</span>
        <span>Skill² Tradeguard · Hackathon 2025</span>
      </div>
    </div>
  )
}

/* ==================== TRAINING PAGE ==================== */
function TrainingPage({ onBack }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [isTraining, setIsTraining] = useState(false)
  const [repCount, setRepCount] = useState(0)
  const [currentScore, setCurrentScore] = useState(null)
  const [coachingTip, setCoachingTip] = useState('Press "Begin Session" when you\'re ready to start.')
  const [isGoodForm, setIsGoodForm] = useState(null)
  const [scoreHistory, setScoreHistory] = useState([])
  const intervalRef = useRef(null)

  // Start webcam
  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          setCameraReady(true)
        }
      } catch (err) {
        console.error('Camera error:', err)
        setCoachingTip('Unable to access camera. Please allow camera permissions.')
      }
    }
    startCamera()

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop())
      }
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Capture frame and send to backend
  const captureAndSend = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    canvas.width = 640
    canvas.height = 480
    ctx.drawImage(videoRef.current, 0, 0, 640, 480)

    const frameData = canvas.toDataURL('image/jpeg', 0.7)

    // ============================================
    // TODO: Replace with real backend API call
    //
    // const response = await fetch('http://localhost:8000/analyze', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ frame: frameData })
    // })
    // const data = await response.json()
    // ============================================

    // MOCK DATA (simulates backend response)
    const mockResponses = [
      { coaching_tip: 'Keep your back straight! Bend at the knees, not the waist.', is_good_form: false, score: 55 },
      { coaching_tip: 'Good knee position! Now engage your core muscles.', is_good_form: true, score: 72 },
      { coaching_tip: 'Excellent form! Keep the object close to your body.', is_good_form: true, score: 88 },
      { coaching_tip: 'Watch your back angle — try to keep it more neutral.', is_good_form: false, score: 45 },
      { coaching_tip: 'Great improvement! Your legs are doing the work now.', is_good_form: true, score: 82 },
      { coaching_tip: 'Perfect lift! Smooth and controlled motion.', is_good_form: true, score: 95 },
      { coaching_tip: 'Remember to breathe. Exhale as you lift up.', is_good_form: true, score: 78 },
      { coaching_tip: 'Careful — your knees are going past your toes.', is_good_form: false, score: 50 },
    ]
    const data = mockResponses[Math.floor(Math.random() * mockResponses.length)]

    setCoachingTip(data.coaching_tip)
    setIsGoodForm(data.is_good_form)
    setCurrentScore(data.score)
    setScoreHistory(prev => [...prev, data.score])
    if (data.is_good_form) {
      setRepCount(prev => prev + 1)
    }
  }, [])

  // Start/stop training loop
  const toggleTraining = () => {
    if (isTraining) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
      setIsTraining(false)
      setCoachingTip('Session paused. Press "Begin Session" to continue.')
    } else {
      setIsTraining(true)
      setCoachingTip('Get into position... Starting analysis.')
      intervalRef.current = setInterval(captureAndSend, 2000)
    }
  }

  const avgScore = scoreHistory.length > 0
    ? Math.round(scoreHistory.reduce((a, b) => a + b, 0) / scoreHistory.length)
    : 0

  return (
    <div className="training">
      {/* Top nav bar */}
      <header className="training-header">
        <button className="back-btn" onClick={onBack}>
          ← Back
        </button>
        <h1 className="training-title">
          Lifting <span className="highlight">Training</span>
        </h1>
        <div className="session-badge">
          <span className={`pulse-dot ${isTraining ? 'live' : ''}`}></span>
          {isTraining ? 'Live' : 'Ready'}
        </div>
      </header>

      {/* Main content */}
      <div className="training-grid">

        {/* LEFT: Camera */}
        <div className="camera-section">
          <div className="camera-container">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="camera-feed"
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {currentScore !== null && isTraining && (
              <div className={`score-overlay ${isGoodForm ? 'good' : 'bad'}`}>
                <span className="score-number">{currentScore}</span>
                <span className="score-label">/ 100</span>
              </div>
            )}

            {isTraining && isGoodForm !== null && (
              <div className={`form-indicator ${isGoodForm ? 'good' : 'bad'}`}>
                {isGoodForm ? '✓ Good Form' : '✗ Needs Correction'}
              </div>
            )}

            {!cameraReady && (
              <div className="camera-placeholder">
                <span>📷</span>
                <p>Connecting camera...</p>
              </div>
            )}
          </div>

          <button
            className={`training-btn ${isTraining ? 'active' : ''}`}
            onClick={toggleTraining}
            disabled={!cameraReady}
          >
            {isTraining ? '⏸  Pause Session' : '▶  Begin Session'}
          </button>
        </div>

        {/* RIGHT: Coaching + Stats */}
        <div className="info-section">

          {/* Coaching panel */}
          <div className="panel coaching-panel">
            <div className="panel-header">
              <span className="panel-icon">🎯</span>
              <h2>AI Coach</h2>
            </div>
            <div className={`coaching-message ${isGoodForm === false ? 'warning' : isGoodForm === true ? 'success' : ''}`}>
              <p>{coachingTip}</p>
            </div>
            <div className="coaching-sub">
              Feedback updates every 2 seconds during training
            </div>
          </div>

          {/* Stats panel */}
          <div className="panel stats-panel">
            <div className="panel-header">
              <span className="panel-icon">📊</span>
              <h2>Session Stats</h2>
            </div>
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-value">{repCount}</span>
                <span className="stat-label">Good Reps</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{currentScore || '—'}</span>
                <span className="stat-label">Current Score</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{avgScore || '—'}</span>
                <span className="stat-label">Avg Score</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{scoreHistory.length}</span>
                <span className="stat-label">Analyses</span>
              </div>
            </div>
          </div>

          {/* Score history chart */}
          {scoreHistory.length > 1 && (
            <div className="panel chart-panel">
              <div className="panel-header">
                <span className="panel-icon">📈</span>
                <h2>Progress</h2>
              </div>
              <div className="mini-chart">
                {scoreHistory.map((score, i) => (
                  <div
                    key={i}
                    className="chart-bar-wrapper"
                    title={`Analysis ${i + 1}: ${score}/100`}
                  >
                    <div
                      className="chart-bar"
                      style={{
                        height: `${score}%`,
                        background: score >= 70
                          ? 'var(--accent)'
                          : score >= 50
                            ? 'var(--warning)'
                            : 'var(--danger)'
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="chart-labels">
                <span>Start</span>
                <span>Current</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
