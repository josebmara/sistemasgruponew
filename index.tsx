import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Brain, Library, LogIn, LogOut, Map, Plus, Send, ShieldCheck, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import ghostie from "@/assets/ghostie-mascot.png";
import { Button } from "@/components/ui/button";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";

type View = "missions" | "chat" | "riddles" | "library";
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; reasoning?: string };
type Material = { id: string; name: string; subject: string; content: string; source_label: string | null };
const subjects = ["Ciencias", "Matemáticas", "Lenguaje", "Historia"];
const riddles = [
  { subject: "Ciencias", question: "No soy ser vivo, pero crezco; necesito aire, aunque no respiro. ¿Qué soy?", answer: "fuego", hint: "Transformo energía y doy calor." },
  { subject: "Matemáticas", question: "Tengo tres lados, tres vértices y la suma de mis ángulos es 180°. ¿Quién soy?", answer: "triángulo", hint: "Mi nombre empieza con tri-." },
  { subject: "Lenguaje", question: "Acompaño al sustantivo y digo cómo es, pero no soy su nombre. ¿Qué soy?", answer: "adjetivo", hint: "Puedo ser alegre, grande o brillante." },
  { subject: "Historia", question: "Guardo hechos en orden para mostrar qué pasó antes y después. ¿Qué soy?", answer: "línea del tiempo", hint: "Se dibuja como un camino con fechas." },
];

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Adivina Estudio | Aprende pensando con Ghostie" },
    { name: "description", content: "Misiones educativas, adivinanzas y apoyo de IA para aprender paso a paso." },
    { property: "og:title", content: "Adivina Estudio" },
    { property: "og:description", content: "Aprende pensando con Ghostie, tu guía educativa." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: App,
});

function App() {
  const [view, setView] = useState<View>("missions");
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"closed" | "login" | "signup">("closed");
  const [notice, setNotice] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [subject, setSubject] = useState("Ciencias");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) { setMaterials([]); return; }
    supabase.from("materials").select("id,name,subject,content,source_label").order("created_at", { ascending: false }).then(({ data }) => setMaterials((data ?? []) as Material[]));
  }, [userId]);

  const relevantMaterials = useMemo(() => materials.filter((m) => m.subject === subject || m.subject === "General"), [materials, subject]);

  async function authenticate() {
    setNotice("");
    const action = authMode === "signup" ? supabase.auth.signUp({ email, password }) : supabase.auth.signInWithPassword({ email, password });
    const { error } = await action;
    setNotice(error ? error.message : authMode === "signup" ? "Revisa tu correo para confirmar tu cuenta." : "¡Qué gusto verte de nuevo!");
    if (!error && authMode === "login") setAuthMode("closed");
  }

  async function googleSignIn() {
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) setNotice(result.error.message);
  }

  async function askGhostie(message: { text: string }) {
    const text = message.text.trim();
    if (!text || loading) return;
    const next: ChatMessage[] = [...messages, { id: crypto.randomUUID(), role: "user", content: text }];
    setMessages(next); setLoading(true); setNotice("");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, grade: "Secundaria", messages: next.map(({ role, content }) => ({ role, content })), materials: relevantMaterials.map((m) => ({ name: m.name, content: m.content, sourceLabel: m.source_label })) }) });
      if (!response.ok) { const error = await response.json() as { message?: string }; throw new Error(error.message ?? "No pude completar la respuesta."); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No pude recibir la respuesta.");
      const assistant: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: "", reasoning: "" };
      setMessages([...next, assistant]);
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer = (buffer + decoder.decode(value, { stream: true })).replaceAll("\r\n", "\n");
        const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
        for (const event of events) for (const line of event.split("\n")) if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try { const data = JSON.parse(line.slice(6)) as { type?: string; delta?: string; error?: { message?: string } };
            if (data.type === "response.output_text.delta") assistant.content += data.delta ?? "";
            if (data.type === "response.reasoning_summary_text.delta") assistant.reasoning = (assistant.reasoning ?? "") + (data.delta ?? "");
            if (data.type === "error") throw new Error(data.error?.message ?? "La respuesta se interrumpió.");
            setMessages([...next, { ...assistant }]);
          } catch (error) { if (error instanceof Error && !line.includes("response.")) throw error; }
        }
      }
      if (!assistant.content) assistant.content = assistant.reasoning || "Terminé de pensarlo, pero no pude formar una respuesta. Inténtalo de nuevo.";
      setMessages([...next, { ...assistant }]);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Ghostie no está disponible ahora."); }
    finally { setLoading(false); }
  }

  return <div className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <button onClick={() => setView("missions")} className="flex items-center gap-2" aria-label="Ir a misiones"><img src={ghostie} alt="Ghostie" className="size-11 object-contain"/><span className="font-display text-lg font-bold">Adivina Estudio</span></button>
        <nav className="hidden items-center gap-1 md:flex">{([["missions","Misiones",Map],["chat","Ghostie",Brain],["riddles","Adivinanzas",Trophy],["library","Biblioteca",Library]] as const).map(([id,label,Icon]) => <Button key={id} variant={view===id?"secondary":"ghost"} onClick={() => setView(id)}><Icon className="size-4"/>{label}</Button>)}</nav>
        {userId ? <Button variant="outline" onClick={() => supabase.auth.signOut()}><LogOut className="size-4"/>Salir</Button> : <Button onClick={() => setAuthMode("login")}><LogIn className="size-4"/>Entrar</Button>}
      </div>
    </header>

    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {view === "missions" && <Missions setView={setView}/>} 
      {view === "chat" && <Chat messages={messages} loading={loading} subject={subject} setSubject={setSubject} ask={askGhostie} materialCount={relevantMaterials.length}/>} 
      {view === "riddles" && <Riddles/>}
      {view === "library" && <LibraryView userId={userId} materials={materials} setMaterials={setMaterials} openAuth={() => setAuthMode("login")}/>} 
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-md border bg-card px-4 py-3 text-sm shadow-lg">{notice}</div>}
    </main>

    <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-card p-2 md:hidden">{([["missions","Misiones",Map],["chat","Ghostie",Brain],["riddles","Retos",Trophy],["library","Materiales",Library]] as const).map(([id,label,Icon]) => <Button key={id} size="sm" variant={view===id?"secondary":"ghost"} onClick={() => setView(id)} className="flex-col gap-0 text-[11px]"><Icon className="size-4"/>{label}</Button>)}</nav>

    {authMode !== "closed" && <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/25 p-4" onMouseDown={() => setAuthMode("closed")}><section className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-xl" onMouseDown={(e) => e.stopPropagation()}><div className="mb-5 flex items-center gap-3"><img src={ghostie} alt="" className="size-16"/><div><h2 className="text-xl font-bold">{authMode === "login" ? "Bienvenido de vuelta" : "Crea tu refugio"}</h2><p className="text-sm text-muted-foreground">Tu avance y materiales serán privados.</p></div></div><div className="space-y-3"><input className="w-full rounded-md border bg-background px-3 py-2" type="email" placeholder="Correo" value={email} onChange={(e)=>setEmail(e.target.value)}/><input className="w-full rounded-md border bg-background px-3 py-2" type="password" placeholder="Contraseña" value={password} onChange={(e)=>setPassword(e.target.value)}/><Button className="w-full" onClick={authenticate}>{authMode === "login" ? "Entrar" : "Crear cuenta"}</Button><Button className="w-full" variant="outline" onClick={googleSignIn}>Continuar con Google</Button><button className="w-full text-sm text-primary" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>{authMode === "login" ? "¿Primera vez? Crea una cuenta" : "Ya tengo una cuenta"}</button></div></section></div>}
  </div>;
}

function Missions({ setView }: { setView: (view: View) => void }) {
  const cards = [{ icon: Brain, title: "Pregunta a Ghostie", copy: "Comprende un tema con pistas y ejemplos.", action: "chat", tone: "bg-secondary" }, { icon: Trophy, title: "Reto del día", copy: "Resuelve una adivinanza y fortalece tu lógica.", action: "riddles", tone: "bg-accent" }, { icon: Library, title: "Tu biblioteca", copy: "Añade apuntes para que Ghostie los tenga en cuenta.", action: "library", tone: "bg-muted" }] as const;
  return <div className="pb-24 enter-soft"><section className="grid min-h-[420px] items-center gap-8 border-b py-8 md:grid-cols-[1.2fr_.8fr]"><div><span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground"><ShieldCheck className="size-4"/>Aprender es una aventura segura</span><h1 className="mt-5 max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">Aprende pensando,<br/><span className="text-primary">no memorizando.</span></h1><p className="mt-5 max-w-xl text-lg text-muted-foreground">Ghostie te acompaña paso a paso para que descubras respuestas, conectes ideas y ganes confianza.</p><Button size="lg" className="mt-7" onClick={() => setView("chat")}><Brain className="size-5"/>Comenzar una misión</Button></div><div className="relative flex justify-center"><div className="absolute bottom-7 h-10 w-64 rounded-full bg-moss/30 blur-lg"/><img src={ghostie} alt="Ghostie, guía de aprendizaje" className="ghostie-float relative w-full max-w-sm object-contain"/></div></section><section className="py-10"><div className="mb-6 flex items-end justify-between"><div><p className="font-semibold text-primary">Tu mapa de hoy</p><h2 className="text-2xl font-bold">Elige una misión</h2></div><span className="hidden text-sm text-muted-foreground sm:block">Cada paso cuenta</span></div><div className="grid gap-4 md:grid-cols-3">{cards.map(({icon:Icon,title,copy,action,tone}) => <button key={title} onClick={() => setView(action)} className="group rounded-lg border bg-card p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-md"><span className={`mb-5 grid size-11 place-items-center rounded-md ${tone}`}><Icon className="size-5"/></span><h3 className="text-lg font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p><span className="mt-5 inline-block text-sm font-bold text-primary">Explorar →</span></button>)}</div></section></div>;
}

function Chat({ messages, loading, subject, setSubject, ask, materialCount }: { messages: ChatMessage[]; loading: boolean; subject: string; setSubject:(v:string)=>void; ask:(m:{text:string})=>void; materialCount:number }) {
  return <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl flex-col pb-16 md:pb-0"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><img src={ghostie} alt="Ghostie" className="size-14"/><div><h1 className="text-2xl font-bold">Explora con Ghostie</h1><p className="text-sm text-muted-foreground">{materialCount ? `${materialCount} material(es) propio(s) disponible(s)` : "Usaré conocimiento escolar general"}</p></div></div><select aria-label="Materia" value={subject} onChange={(e)=>setSubject(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">{subjects.map((s)=><option key={s}>{s}</option>)}</select></div><div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card"><Conversation><ConversationContent>{messages.length === 0 && <ConversationEmptyState icon={<img src={ghostie} alt="" className="size-24"/>} title="¿Qué quieres descubrir hoy?" description="Cuéntame qué tema te cuesta. Te daré pistas, ejemplos y una pregunta para comprobarlo."/>}{messages.map((m)=><Message key={m.id} from={m.role}><MessageContent className={m.role==="user"?"bg-chat-user text-chat-user-foreground":""}>{m.reasoning && <Reasoning defaultOpen={false}><ReasoningTrigger/><ReasoningContent>{m.reasoning}</ReasoningContent></Reasoning>}<MessageResponse>{m.content}</MessageResponse></MessageContent></Message>)}{loading && messages.at(-1)?.role === "user" && <Shimmer className="text-sm">Ghostie está pensando...</Shimmer>}</ConversationContent><ConversationScrollButton/></Conversation></div><div className="mt-3"><PromptInput onSubmit={ask}><PromptInputTextarea placeholder="Escribe tu duda o pega un ejercicio..."/><PromptInputFooter className="justify-end"><PromptInputSubmit status={loading?"streaming":"ready"} disabled={loading}><Send className="size-4"/></PromptInputSubmit></PromptInputFooter></PromptInput></div></div>;
}

function Riddles() {
  const [index,setIndex]=useState(0); const [value,setValue]=useState(""); const [result,setResult]=useState(""); const r=riddles[index] ?? riddles[0];
  if (!r) return null;
  return <div className="mx-auto max-w-3xl pb-24 enter-soft"><p className="font-semibold text-primary">Bosque de acertijos</p><h1 className="mt-1 text-3xl font-bold">Entrena tu curiosidad</h1><div className="mt-8 rounded-lg border bg-card p-6 shadow-sm"><div className="flex items-center justify-between"><span className="rounded-full bg-secondary px-3 py-1 text-sm font-bold">{r.subject}</span><span className="text-sm text-muted-foreground">{index+1} de {riddles.length}</span></div><h2 className="mt-7 text-2xl font-semibold leading-relaxed">{r.question}</h2><p className="mt-5 rounded-md bg-muted p-3 text-sm"><strong>Pista:</strong> {r.hint}</p><div className="mt-6 flex gap-2"><input aria-label="Tu respuesta" value={value} onChange={(e)=>setValue(e.target.value)} className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2" placeholder="Tu respuesta..."/><Button onClick={()=>setResult(value.trim().toLocaleLowerCase("es").includes(r.answer)?"¡Muy bien! Explicaste la idea correcta.":"Aún no. Vuelve a leer la pista y prueba otra relación.")}>Comprobar</Button></div>{result && <p className="mt-4 font-semibold text-primary">{result}</p>}<Button variant="outline" className="mt-7" onClick={()=>{setIndex((index+1)%riddles.length);setValue("");setResult("");}}>Siguiente reto</Button></div></div>;
}

function LibraryView({ userId, materials, setMaterials, openAuth }: { userId:string|null; materials:Material[]; setMaterials:(m:Material[])=>void; openAuth:()=>void }) {
  const [adding,setAdding]=useState(false); const [name,setName]=useState(""); const [subject,setSubject]=useState("Ciencias"); const [content,setContent]=useState("");
  async function save(){ if(!userId||!name.trim()||!content.trim())return; const {data,error}=await supabase.from("materials").insert({user_id:userId,name:name.trim(),subject,content:content.trim(),kind:"Apunte",source_label:"Material propio"}).select("id,name,subject,content,source_label").single(); if(!error&&data){setMaterials([data as Material,...materials]);setAdding(false);setName("");setContent("");}}
  if(!userId)return <div className="mx-auto max-w-xl py-20 text-center"><img src={ghostie} alt="" className="mx-auto size-32"/><h1 className="mt-4 text-3xl font-bold">Tu biblioteca privada</h1><p className="mt-3 text-muted-foreground">Inicia sesión para guardar apuntes y permitir que Ghostie los use como contexto prioritario.</p><Button className="mt-6" onClick={openAuth}><LogIn className="size-4"/>Entrar para continuar</Button></div>;
  return <div className="pb-24 enter-soft"><div className="flex items-end justify-between gap-4"><div><p className="font-semibold text-primary">Materiales propios</p><h1 className="text-3xl font-bold">Tu biblioteca</h1></div><Button onClick={()=>setAdding(!adding)}><Plus className="size-4"/>Añadir apunte</Button></div>{adding&&<div className="mt-6 grid gap-3 rounded-lg border bg-card p-5"><input value={name} onChange={(e)=>setName(e.target.value)} className="rounded-md border bg-background px-3 py-2" placeholder="Nombre del material"/><select value={subject} onChange={(e)=>setSubject(e.target.value)} className="rounded-md border bg-background px-3 py-2">{[...subjects,"General"].map((s)=><option key={s}>{s}</option>)}</select><textarea value={content} onChange={(e)=>setContent(e.target.value)} className="min-h-40 rounded-md border bg-background px-3 py-2" placeholder="Pega aquí tus apuntes o un resumen..."/><Button onClick={save}>Guardar material</Button></div>}<div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{materials.map((m)=><article key={m.id} className="rounded-lg border bg-card p-5"><span className="text-xs font-bold uppercase text-primary">{m.subject}</span><BookOpen className="mt-5 size-6 text-muted-foreground"/><h2 className="mt-3 font-bold">{m.name}</h2><p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{m.content}</p></article>)}{!materials.length&&<p className="text-muted-foreground">Aún no hay materiales. Añade el primero para personalizar las respuestas.</p>}</div></div>;
}
