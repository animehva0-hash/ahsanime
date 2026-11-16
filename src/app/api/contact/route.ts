import type { NextRequest } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // Contact form abuse guard: 3 messages / 10 minutes per IP.
    const rl = rateLimit(`ct:${clientIp(request)}`, 3, 10 * 60_000);
    if (!rl.ok) {
      return Response.json(
        { error: "Too many messages. Please try again later." },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { name, email, subject, message } = body ?? {};

    // Basic shape + length validation.
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    if (
      !str(name) || !str(email) || !str(subject) || !str(message) ||
      str(name).length > 100 ||
      str(email).length > 160 ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(email)) ||
      str(subject).length > 200 ||
      str(message).length > 5000
    ) {
      return Response.json({ error: "All fields are required" }, { status: 400 });
    }

    if (!name || !email || !subject || !message) {
      return Response.json({ error: "All fields are required" }, { status: 400 });
    }

    // Send via formsubmit.co
    const res = await fetch("https://formsubmit.co/ajax/inrelam@gmail.com", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        name,
        email,
        subject,
        message,
        _subject: `[AHSANIME] ${subject}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      return Response.json({ message: "Message sent successfully!" });
    }

    return Response.json({ error: "Failed to send message" }, { status: 500 });
  } catch (error) {
    console.error("Contact error:", error);
    return Response.json({ error: "Failed to send message" }, { status: 500 });
  }
}
