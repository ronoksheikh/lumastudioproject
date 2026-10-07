import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FieldError, Input, Label, Spinner, TextField } from '@heroui/react';
import { Button } from '../components/Button';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError, api, setCsrf } from '../api/client';
import { Captcha } from '../components/Captcha';
import { Logo } from '../components/Logo';
import { usePageTitle } from '../lib/page-title';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  usePageTitle(mode === 'signup' ? 'Create your account' : null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const signup = mode === 'signup';
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig, staleTime: Infinity });
  const signupOpen = cfg.data?.signupEnabled === true;
  const siteKey = signup ? cfg.data?.captchaSiteKey ?? null : null;
  const [captcha, setCaptcha] = useState('');
  const onToken = useCallback((t: string) => setCaptcha(t), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = signup ? await api.signup(email, password, captcha || undefined) : await api.login(email, password);
      setCsrf(r.csrfToken);
      qc.setQueryData(['me'], { user: r.user, csrfToken: r.csrfToken });
      nav('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // accounts come from lumademy.com when sign-up is closed: /signup just shows the login
  if (signup && cfg.data && !signupOpen) return <Navigate to="/login" replace />;

  return (
    <div className="flex min-h-full flex-col bg-white px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
      <main className="mx-auto flex w-full max-w-[360px] flex-1 flex-col justify-center">
        <Logo variant="blue" className="mb-10 h-7 self-start" />
        <h1 className="text-[28px] font-semibold tracking-tight text-[#1f2937]">{signup ? 'Create your account' : 'Log in to Luma Studio'}</h1>
        <p className="mt-1.5 text-[15px] text-[#5b6b8f]">{signup ? 'Make motion-graphics videos from a single prompt.' : 'Welcome back. Pick up where you left off.'}</p>

        <form onSubmit={submit} className="mt-8 flex flex-col gap-4" noValidate>
          <TextField type="email" value={email} onChange={setEmail} isRequired name="email">
            <Label>Email</Label>
            <Input placeholder="you@example.com" autoComplete="email" />
          </TextField>
          <TextField type="password" value={password} onChange={setPassword} isRequired name="password" isInvalid={signup && password.length > 0 && password.length < 8}>
            <Label>Password</Label>
            <Input placeholder={signup ? 'At least 8 characters' : 'Your password'} autoComplete={signup ? 'new-password' : 'current-password'} />
            <FieldError>Use at least 8 characters.</FieldError>
          </TextField>
          {siteKey && <Captcha siteKey={siteKey} onToken={onToken} />}
          {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
          <Button type="submit" variant="primary" size="lg" isDisabled={busy || !email || !password || (!!siteKey && !captcha)} className="mt-2 w-full">
            {busy ? <Spinner size="sm" color="current" /> : signup ? 'Create account' : 'Log in'}
          </Button>
        </form>

        <p className="mt-6 text-sm text-[#5b6b8f]">
          {signup ? (
            <>Already have an account? <Link to="/login" className="font-medium text-[#2970ec]">Log in</Link></>
          ) : signupOpen ? (
            <>New here? <Link to="/signup" className="font-medium text-[#2970ec]">Create an account</Link></>
          ) : (
            <>No account yet? Enrol at <a href="https://lumademy.com" className="font-medium text-[#2970ec]">lumademy.com</a> — your login is emailed to you.</>
          )}
        </p>
      </main>
      <footer className="mx-auto w-full max-w-[360px] pt-10 text-xs leading-relaxed text-[#8a97b5]">
        <p><b className="font-semibold text-[#5b6b8f]">Luma Studio</b> is an AI motion-graphics agent by <a href="https://lumademy.com" className="text-[#2970ec]">Lumademy</a>: describe a video and it writes the script, records the voiceover, animates every scene and renders a 1080p MP4.</p>
        <p className="mt-2">For Lumademy AI Motion Graphics Crash Course students · <Link to="/docs/api" className="text-[#2970ec]">API docs</Link></p>
      </footer>
    </div>
  );
}
