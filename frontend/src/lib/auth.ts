import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
  CognitoIdToken,
  CognitoAccessToken,
  CognitoRefreshToken,
  ISignUpResult,
} from "amazon-cognito-identity-js";
import { config } from "../config";

const userPool = new CognitoUserPool({
  UserPoolId: config.cognitoUserPoolId,
  ClientId: config.cognitoClientId,
});

interface StoredTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  expiresAt: number;
}

const TOKEN_KEY = "stravify_tokens";

function read(): StoredTokens | null {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); }
  catch { return null; }
}
function write(t: StoredTokens) { localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); }
function clear() { localStorage.removeItem(TOKEN_KEY); }

function storeSession(email: string, session: CognitoUserSession) {
  write({
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: session.getIdToken().getExpiration() * 1000,
    email,
  });
}

export function signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  return new Promise((resolve, reject) => {
    userPool.signUp(
      email,
      password,
      [new CognitoUserAttribute({ Name: "email", Value: email })],
      [],
      (err: Error | undefined, result: ISignUpResult | undefined) => {
        if (err) return reject(err);
        resolve({ needsConfirmation: !result?.userConfirmed });
      },
    );
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export function resendConfirmationCode(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export function signIn(email: string, password: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: userPool });
  const auth = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(auth, {
      onSuccess: (session) => { storeSession(email, session); resolve(); },
      onFailure: (err) => reject(err),
      newPasswordRequired: () => reject(new Error("New password required — finish setup in the AWS console.")),
    });
  });
}

export function signOut() {
  const user = userPool.getCurrentUser();
  user?.signOut();
  clear();
}

// Builds a CognitoUser whose session is pre-set from our stored tokens, so
// authenticated calls like changePassword/deleteUser don't have to look up
// tokens in the SDK's localStorage format (which we don't use).
async function authenticatedUser(): Promise<CognitoUser> {
  // Refresh once to make sure tokens we have aren't expired.
  await refreshSession().catch(() => {});
  const t = read();
  if (!t) throw new Error("Not signed in");
  const user = new CognitoUser({ Username: t.email, Pool: userPool });
  const session = new CognitoUserSession({
    IdToken: new CognitoIdToken({ IdToken: t.idToken }),
    AccessToken: new CognitoAccessToken({ AccessToken: t.accessToken }),
    RefreshToken: new CognitoRefreshToken({ RefreshToken: t.refreshToken }),
  });
  user.setSignInUserSession(session);
  return user;
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const user = await authenticatedUser();
  return new Promise((resolve, reject) => {
    user.changePassword(oldPassword, newPassword, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export async function deleteCognitoUser(): Promise<void> {
  const user = await authenticatedUser();
  return new Promise((resolve, reject) => {
    user.deleteUser((err) => {
      if (err) return reject(err);
      clear();
      resolve();
    });
  });
}

function getCachedUser(email: string): CognitoUser {
  return new CognitoUser({ Username: email, Pool: userPool });
}

function refreshSession(): Promise<CognitoUserSession> {
  const t = read();
  if (!t) return Promise.reject(new Error("No tokens stored"));
  const user = getCachedUser(t.email);
  return new Promise((resolve, reject) => {
    user.refreshSession(
      { getToken: () => t.refreshToken } as any,
      (err, session) => {
        if (err) return reject(err);
        storeSession(t.email, session);
        resolve(session);
      },
    );
  });
}

export async function getValidTokens(): Promise<StoredTokens | null> {
  const t = read();
  if (!t) return null;
  // 30s buffer
  if (Date.now() < t.expiresAt - 30_000) return t;
  try {
    await refreshSession();
    return read();
  } catch {
    clear();
    return null;
  }
}

export function getStoredEmail(): string | null {
  return read()?.email ?? null;
}
