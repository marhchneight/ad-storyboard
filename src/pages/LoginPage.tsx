import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

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
    <div className="login-page">
      <h1>광고 콘티 스토리보드</h1>
      <form onSubmit={handleSubmit}>
        <input type="email" placeholder="이메일" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="비밀번호" value={password}
          onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        {error && <p className="error">{error}</p>}
        <button type="submit">{mode === 'signin' ? '로그인' : '회원가입'}</button>
      </form>
      <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
      </button>
    </div>
  );
}
