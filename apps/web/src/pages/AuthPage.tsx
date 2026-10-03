import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, FieldError, Input, Label, Spinner, TextField } from '@heroui/react';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api, setCsrf } from '../api/client';
import { Captcha } from '../components/Captcha';
import { Logo } from '../components/Logo';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const signup = mode === 'signup';
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: api.authConfig, enabled: signup, staleTime: Infinity });
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

  return (
    <div className="luma-gradient grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo variant="white" className="h-9" />
        </div>
        <Card className="p-2">
          <Card.Header>
            <Card.Title className="text-xl">{signup ? 'Create your Luma Studio account' : 'Welcome back'}</Card.Title>
            <Card.Description>{signup ? 'Make AI motion-graphics videos from a single prompt.' : 'Log in to keep building your videos.'}</Card.Description>
          </Card.Header>
          <Card.Content>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
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
              {error && (
                <p role="alert" className="rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#7f1d1d]">{error}</p>
              )}
              <Button type="submit" variant="primary" isDisabled={busy || !email || !password || (!!siteKey && !captcha)} className="w-full">
                {busy ? <Spinner size="sm" color="current" /> : signup ? 'Create account' : 'Log in'}
              </Button>
            </form>
          </Card.Content>
          <Card.Footer className="justify-center text-sm text-[#5b6b8f]">
            {signup ? (
              <span>Already have an account? <Link to="/login" className="font-semibold text-[#2970ec]">Log in</Link></span>
            ) : (
              <span>New here? <Link to="/signup" className="font-semibold text-[#2970ec]">Create an account</Link></span>
            )}
          </Card.Footer>
        </Card>
        <p className="mt-6 text-center text-xs text-white/80">Free for Lumademy AI Motion Graphics Crash Course students.</p>
      </div>
    </div>
  );
}
