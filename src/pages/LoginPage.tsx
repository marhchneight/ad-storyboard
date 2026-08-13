import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import ThemeToggle from '../components/ThemeToggle';
import GuineaPig from '../components/GuineaPig';

const HAS_VISITED_KEY = 'ad-storyboard-has-visited';

function readIsFirstVisit(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(HAS_VISITED_KEY) == null;
  } catch {
    return false;
  }
}

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [isFirstVisit] = useState(readIsFirstVisit);

  useEffect(() => {
    try {
      localStorage.setItem(HAS_VISITED_KEY, '1');
    } catch {
      // localStorage unavailable (private mode, etc.) — welcome copy just
      // falls back to "first visit" every time, which is harmless.
    }
  }, []);

  const welcomeTitle = isFirstVisit ? '아이디어를 콘티로 만들어볼까요?' : '다시 만나서 반가워요.';

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
      <GuineaPig />
      <div className="auth-page-toggle">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <p className="eyebrow">Ad Storyboard Studio</p>
        <h1>{welcomeTitle}</h1>
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
