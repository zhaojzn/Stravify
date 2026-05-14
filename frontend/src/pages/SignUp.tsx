import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signUp } from "../lib/auth";
import { AuthShell, Field, SubmitButton, ErrorMsg } from "./auth-ui";

export function SignUp() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const trimmed = email.trim();
      const { needsConfirmation } = await signUp(trimmed, password);
      if (needsConfirmation) {
        // Carry the password through to Confirm so we can auto-sign-in
        // after the user enters the code (no extra log-in step).
        navigate(`/confirm?email=${encodeURIComponent(trimmed)}`, {
          state: { password },
        });
      } else {
        navigate("/signin");
      }
    } catch (err: any) {
      setError(err?.message || "Sign up failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      foot={<>Already have an account? <Link to="/signin" className="text-brand hover:underline">Log in</Link></>}
    >
      <form onSubmit={onSubmit}>
        <Field
          label="Email" type="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password" type="password" autoComplete="new-password"
          required minLength={10}
          hint="At least 10 characters with a lower-case letter and a digit."
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <SubmitButton busy={busy} label="Create account" busyLabel="Creating account…" />
      </form>
    </AuthShell>
  );
}
