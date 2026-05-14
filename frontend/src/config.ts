interface StravifyConfig {
  apiBaseUrl: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  appUrl: string;
}

declare global {
  interface Window { STRAVIFY_CONFIG: StravifyConfig }
}

export const config: StravifyConfig = window.STRAVIFY_CONFIG;
