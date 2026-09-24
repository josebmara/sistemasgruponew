import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { GATEWAY_URL, safeGatewayMessage } from "@/lib/ai-gateway.server";

const Body = z.object({
  subject: z.string().min(1).max(60), grade: z.string().min(1).max(60),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(12000) })).max(30),
  materials: z.array(z.object({ name: z.string().max(160), content: z.string().max(18000), sourceLabel: z.string().max(200).nullable() })).max(8),
});
const instructions = `Eres Ghostie, guía educativa de Adivina Estudio para menores. Responde siempre en español claro, cálido y preciso. Reconoce la duda, explica la idea esencial al nivel del estudiante, da una pista o ejemplo sin resolver directamente una evaluación, termina con una sola pregunta para comprobar comprensión y nombra cualquier material aportado que uses. No inventes fuentes, datos ni citas. Distingue hechos de interpretaciones. No solicites información personal. Mantén la respuesta entre 120 y 280 palabras salvo que pidan más detalle.`;

export const Route = createFileRoute("/api/chat")({ server: { handlers: { POST: async ({ request }) => {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) return Response.json({ message: "La IA no está configurada." }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await request.json()); } catch { return Response.json({ message: "La consulta no tiene un formato válido." }, { status: 400 }); }
  const context = body.materials.length ? body.materials.map((m) => `MATERIAL: ${m.name}${m.sourceLabel ? ` (${m.sourceLabel})` : ""}\n${m.content}`).join("\n\n") : "No hay materiales propios vinculados.";
  const upstream = await fetch(GATEWAY_URL, { method: "POST", headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" }, body: JSON.stringify({ model: "openai/gpt-6-astra", stream: true, reasoning: { effort: "medium", summary: "auto" }, include: ["reasoning.encrypted_content"], instructions: `${instructions}\nMateria: ${body.subject}. Nivel: ${body.grade}.\n${context}`, input: body.messages.map((m) => ({ role: m.role, content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }] })) }) });
  if (!upstream.ok) return Response.json({ message: safeGatewayMessage(upstream.status, await upstream.text()) }, { status: upstream.status });
  return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream", "Cache-Control": "no-cache" } });
} } } });
