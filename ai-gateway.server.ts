export const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
export function safeGatewayMessage(status: number, raw: string) {
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: { message?: string } };
    return parsed.message ?? parsed.error?.message ?? `Ghostie no pudo responder (${status}).`;
  } catch { return raw || `Ghostie no pudo responder (${status}).`; }
}
