import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { confirmSignUp, resendConfirmationCode, signIn } from "../lib/auth";
import { AuthShell, Field, SubmitButton, ErrorMsg, InfoMsg } from "./auth-ui";

export function Confirm() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set by SignUp via navigate(state). Used to auto-sign-in after confirmation
  // so the user doesn't have to retype their password.
  const cachedPassword = (location.state as { password?: string } | null)?.password;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    const trimmed = email.trim();
    try {
      await confirmSignUp(trimmed, code.trim());
      if (cachedPassword) {
        try {
          await signIn(trimmed, cachedPassword);
          navigate("/dashboard", { replace: true });
          return;
        } catch {
          // Auto-sign-in failed for some reason — fall back to the manual flow.
        }
      }
      navigate("/signin");
    } catch (err: any) {
      setError(err?.message || "Confirmation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setError(null); setInfo(null);
    try {
      await resendConfirmationCode(email.trim());
      setInfo("New code sent — check your email.");
    } catch (err: any) {
      setError(err?.message || "Couldn't resend.");
    }
  }

  return (
    <AuthShell
      title="Confirm your email"
      subtitle="We sent a 6-digit code to your inbox."
      foot={
        <>
          <button type="button" onClick={onResend} className="text-brand hover:underline">Resend code</button>
          <span className="text-muted"> · </span>
          <Link to="/signin" className="text-brand hover:underline">Back to log in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label="Email" type="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Verification code" type="text"
          inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code"
          required value={code} onChange={(e) => setCode(e.target.value)}
        />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        {info && <InfoMsg>{info}</InfoMsg>}
        <SubmitButton busy={busy} label="Confirm" busyLabel="Confirming…" />
      </form>
    </AuthShell>
  );
}
