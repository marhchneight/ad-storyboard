import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import ThemeToggle from '../components/ThemeToggle';
import DitheringSwirlBackground from '../components/DitheringSwirlBackground';

// Mirrors the --bg / --ink token values in index.css for each theme, so the
// swirl reads as the same studio's day/night palette rather than a separate look.
const SWIRL_PALETTE = {
  light: { back: '#FAFAF8', front: '#111111', opacity: 0.16 },
  dark: { back: '#0B0B0B', front: '#F2F2F2', opacity: 0.2 },
};

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const swirl = SWIRL_PALETTE[theme];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = mode === 'signin'
      ? await signIn(email, password)
      : await signUp(email, password);
    if (error) {
      setError(error.message);
      return;
    }
    navigate('/');
  }

  return (
    <div className="auth-page">
      <DitheringSwirlBackground
        colorBack={swirl.back}
        colorFront={swirl.front}
        opacity={swirl.opacity}
        speed={0.3}
        pxSize={5}
      />
      <div className="auth-page-toggle">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <p className="eyebrow">Ad Storyboard Studio</p>
        <h1>Welcome back.</h1>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <span className="field-label">Email</span>
            <input type="email" placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <span className="field-label">Password</span>
            <input type="password" placeholder="6+ characters" value={password}
              onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn-primary btn-block">
            {mode === 'signin' ? 'Log in' : 'Sign up'}
          </button>
        </form>
        <button type="button" className="btn-text" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
