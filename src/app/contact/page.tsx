"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Mail, Send } from "lucide-react";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const update =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setOk(json.message ?? "Message sent successfully!");
        setForm({ name: "", email: "", subject: "", message: "" });
      } else {
        setErr(json.error ?? "Failed to send message");
      }
    } catch {
      setErr("Failed to send message");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none transition-all focus:border-[#ff8a00]/60 focus:bg-white/10 focus:ring-2 focus:ring-[#ff8a00]/20";

  return (
    <div className="mx-auto max-w-2xl px-3 py-10 sm:px-4 lg:px-6 animate-fade-up">
      <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#ffb86b]">Reach out</p>
      <h1 className="font-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-white">
        <Mail className="h-7 w-7 text-[#ff8a00]" /> Contact Us
      </h1>
      <p className="mt-3 max-w-lg text-sm text-zinc-500">
        DMCA notices, bug reports, feature ideas — sab yahan bhejo. We usually reply within
        48–72 hours at <span className="text-zinc-300">inrelam@gmail.com</span>.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl border border-white/5 bg-white/[0.02] p-5 sm:p-7">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Name
            </label>
            <input required value={form.name} onChange={update("name")} className={inputCls} placeholder="Tumhara naam" />
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Email
            </label>
            <input required type="email" value={form.email} onChange={update("email")} className={inputCls} placeholder="you@example.com" />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Subject
          </label>
          <input required value={form.subject} onChange={update("subject")} className={inputCls} placeholder="DMCA / Bug / Feedback…" />
        </div>
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Message
          </label>
          <textarea
            required
            rows={6}
            value={form.message}
            onChange={update("message")}
            className={`${inputCls} resize-none`}
            placeholder="Likho kya kehna hai…"
          />
        </div>

        {ok && (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> {ok}
          </p>
        )}
        {err && (
          <p className="rounded-xl bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-300">
            {err}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2.5 rounded-full bg-gradient-to-r from-[#ff8a00] to-[#ff3d5a] px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-[#ff3d5a]/30 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy ? "Sending…" : "Send Message"}
        </button>
      </form>
      <div className="h-10" />
    </div>
  );
}
