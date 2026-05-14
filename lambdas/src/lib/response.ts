import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

export const ok = (body: unknown) => json(200, body);
export const bad = (msg: string) => json(400, { error: msg });
export const unauthorized = () => json(401, { error: "unauthorized" });
export const notFound = () => json(404, { error: "not found" });
export const serverError = (msg: string) => json(500, { error: msg });

export function redirect(url: string): APIGatewayProxyStructuredResultV2 {
  return { statusCode: 302, headers: { Location: url }, body: "" };
}

export function getUserSub(event: any): string | null {
  return event?.requestContext?.authorizer?.jwt?.claims?.sub ?? null;
}
export function getUserEmail(event: any): string | null {
  return event?.requestContext?.authorizer?.jwt?.claims?.email ?? null;
}
