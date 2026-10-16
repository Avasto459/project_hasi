"use client";

import { MessageCircle, Send, X, LoaderCircle } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type PublicMessage = {
  id: string; message: string; status: "NEW" | "READ" | "ANSWERED";
  replyText: string; isReplied: boolean; repliedAt: string | null; createdAt: string;
};
type VisitorItem = { id: string; token: string };
const ITEMS_KEY = "hasi-contact-messages";
const SEEN_KEY = "hasi-contact-seen";
const GUEST_NAME_KEY = "hasi-chat-guest-name";
const GUEST_PHONE_KEY = "hasi-chat-guest-phone";
const SENT_EVENT = "hasi:contact-sent";
const POLL_MS = 5000;
function readJson<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) || "null") ?? fallback) as T; } catch { return fallback; }
}
export function rememberContactMessage(id: string, token: string) {
  const items = readJson<VisitorItem[]>(ITEMS_KEY, []).filter((item) => item.id !== id);
  localStorage.setItem(ITEMS_KEY, JSON.stringify([{ id, token }, ...items].slice(0, 50)));
  window.dispatchEvent(new Event(SENT_EVENT));
}

/** Always-visible support widget. Messages use the existing persistent contact-message API. */
export function MyMessagesWidget() {
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const openRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const markSeen = useCallback((list: PublicMessage[]) => {
    const next = readJson<Record<string, string>>(SEEN_KEY, {});
    for (const item of list) if (item.isReplied && item.repliedAt) next[item.id] = item.repliedAt;
    localStorage.setItem(SEEN_KEY, JSON.stringify(next)); setSeen(next);
  }, []);
  const refresh = useCallback(async () => {
    const items = readJson<VisitorItem[]>(ITEMS_KEY, []);
    const auth = localStorage.getItem("hasi-token");
    if (!items.length && !auth) return;
    try {
      const response = await fetch("/api/messages", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify({ items }) });
      if (!response.ok) return;
      const data = await response.json() as { messages?: PublicMessage[] };
      const list = data.messages || []; setMessages(list); if (openRef.current) markSeen(list);
    } catch { /* retry on next poll */ }
  }, [markSeen]);
  useEffect(() => {
    setSeen(readJson<Record<string, string>>(SEEN_KEY, {}));
    setIsLoggedIn(Boolean(localStorage.getItem("hasi-token")));
    if (!localStorage.getItem("hasi-token")) {
      const storedName = localStorage.getItem(GUEST_NAME_KEY);
      const storedPhone = localStorage.getItem(GUEST_PHONE_KEY);
      if (storedName) setName(storedName);
      if (storedPhone) setPhone(storedPhone);
    }
    const loadProfile = async () => {
      const token = localStorage.getItem("hasi-token");
      if (!token) return;
      try {
        const response = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (response.ok) {
          const data = await response.json() as { user?: { firstName?: string; lastName?: string; name?: string; phone?: string } };
          const user = data.user;
          if (user) { setName([user.firstName, user.lastName].filter(Boolean).join(" ") || user.name || "Пользователь HASI"); setPhone(user.phone || ""); }
        }
      } catch { /* guest fields remain available */ }
    };
    void loadProfile(); void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    const onSent = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onAuth = () => { setIsLoggedIn(Boolean(localStorage.getItem("hasi-token"))); void loadProfile(); void refresh(); };
    window.addEventListener(SENT_EVENT, onSent); window.addEventListener("hasi-auth-changed", onAuth); document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); window.removeEventListener(SENT_EVENT, onSent); window.removeEventListener("hasi-auth-changed", onAuth); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);
  useEffect(() => {
    openRef.current = open;
    if (open) {
      const scroll = () => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      requestAnimationFrame(scroll);
    }
  }, [open, messages]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess("");
    if (!message.trim()) { setError("Введите сообщение."); return; }
    if (!isLoggedIn && (!name.trim() || !phone.trim())) { setError("Укажите имя и телефон, чтобы мы могли ответить."); return; }
    setSending(true);
    try {
      const token = localStorage.getItem("hasi-token");
      const response = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ name: name.trim() || "Пользователь HASI", phone: phone.trim() || "Не указан", message: message.trim() }) });
      const data = await response.json() as { error?: string; id?: string; visitorToken?: string; message?: string };
      if (!response.ok || !data.id || !data.visitorToken) throw new Error(data.error || "Не удалось отправить сообщение.");
      rememberContactMessage(data.id, data.visitorToken); setMessage(""); setSuccess("Сообщение отправлено. Ответ появится в этом окне."); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ошибка отправки. Попробуйте ещё раз."); }
    finally { setSending(false); }
  }

  const unread = messages.filter((item) => item.isReplied && item.repliedAt && seen[item.id] !== item.repliedAt).length;
  const buttonLabel = unread > 0 ? `Открыть онлайн-чат, новых ответов: ${unread}` : "Открыть онлайн-чат";
  function toggle() { const next = !open; setOpen(next); if (next) markSeen(messages); }
  return (
    <div className="fixed bottom-20 right-4 z-[90] sm:bottom-6 sm:right-6">
      {open ? <section aria-label="Онлайн-чат HASI" className="mb-3 flex max-h-[min(78vh,650px)] w-[min(94vw,390px)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex items-center justify-between bg-gradient-to-r from-violet-700 to-indigo-700 px-4 py-3 text-white"><div><h2 className="text-sm font-bold">Онлайн-чат HASI.TJ</h2><p className="text-xs text-violet-100">Напишите нам — мы поможем</p></div><button type="button" onClick={toggle} aria-label="Закрыть чат" className="rounded-full p-2 hover:bg-white/20"><X className="h-4 w-4" /></button></header>
        <div className="min-h-28 flex-1 space-y-3 overflow-y-auto p-4">
          {!messages.length ? <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Здравствуйте! Напишите вопрос о товаре, заказе или доставке.</p> : null}
          {messages.slice().reverse().map((item) => <article key={item.id} className="space-y-2"><div className="ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-violet-100 px-3 py-2 text-sm text-violet-950 dark:bg-violet-900/40 dark:text-violet-100"><p className="whitespace-pre-wrap break-words">{item.message}</p><time className="mt-1 block text-[10px] opacity-60">{new Date(item.createdAt).toLocaleString("ru-RU")}</time></div>{item.isReplied && item.replyText ? <div className="max-w-[88%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-900 dark:bg-slate-800 dark:text-slate-100"><p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Ответ HASI.TJ</p><p className="whitespace-pre-wrap break-words">{item.replyText}</p>{item.repliedAt ? <time className="mt-1 block text-[10px] opacity-60">{new Date(item.repliedAt).toLocaleString("ru-RU")}</time> : null}</div> : <p className="text-xs text-slate-500">Ожидаем ответ администратора…</p>}</article>)}<div ref={bottomRef}/>
        </div>
        <form onSubmit={submit} className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-700">
          {!isLoggedIn && (!name.trim() || !phone.trim()) ? <div className="grid grid-cols-2 gap-2"><input value={name} onChange={(e) => { setName(e.target.value); localStorage.setItem(GUEST_NAME_KEY, e.target.value); }} placeholder="Ваше имя" aria-label="Ваше имя" maxLength={200} required className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"/><input value={phone} onChange={(e) => { setPhone(e.target.value); localStorage.setItem(GUEST_PHONE_KEY, e.target.value); }} placeholder="Телефон" aria-label="Телефон" maxLength={100} required className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"/></div> : <p className="text-xs text-slate-500">{isLoggedIn ? `Вы вошли в аккаунт${name ? ` как ${name}` : ""}` : `Готово, ${name || "гость"}. Напишите сообщение ниже.`}</p>}
          <div className="flex items-end gap-2"><textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Напишите сообщение…" aria-label="Сообщение" rows={2} maxLength={2000} required className="min-w-0 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"/><button disabled={sending} type="submit" aria-label="Отправить сообщение" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-700 text-white hover:bg-violet-600 disabled:opacity-60">{sending ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <Send className="h-4 w-4"/>}</button></div>
          {error ? <p role="alert" className="text-xs text-rose-600">{error}</p> : null}{success ? <p role="status" className="text-xs text-emerald-600">{success}</p> : null}
        </form>
      </section> : null}
      <button type="button" onClick={toggle} aria-label={buttonLabel} aria-expanded={open} className="relative ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-violet-700 text-white shadow-lg ring-4 ring-violet-700/15 transition hover:scale-105 hover:bg-violet-600 active:scale-95"><MessageCircle className="h-6 w-6"/>{unread > 0 ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[11px] font-bold">{unread}</span> : null}</button>
    </div>
  );
}
