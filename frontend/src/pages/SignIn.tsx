import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getValidTokens, signIn } from "../lib/auth";
import { AuthShell, Field, SubmitButton, ErrorMsg } from "./auth-ui";

export function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getValidTokens().then(t => { if (t) navigate("/dashboard"); });
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await signIn(email.trim(), password);
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      const msg = err?.message || "Sign in failed.";
      if (err?.code === "UserNotConfirmedException" || /not confirmed/i.test(msg)) {
        navigate(`/confirm?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Log in to Stravify"
      foot={<>Don't have an account? <Link to="/signup" className="text-brand hover:underline">Sign up</Link></>}
    >
      <form onSubmit={onSubmit}>
        <Field
          label="Email" type="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <SubmitButton busy={busy} label="Log in" busyLabel="Signing in…" />
      </form>
    </AuthShell>
  );
}
