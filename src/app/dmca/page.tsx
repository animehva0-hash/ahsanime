import type { Metadata } from "next";
import Link from "next/link";
import { Scale, FileWarning, Mail, Clock3 } from "lucide-react";

export const metadata: Metadata = {
  title: "DMCA Notice",
  description: "DMCA filing information for AHSANIME — content aggregator, no hosted media.",
};

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
        <Icon className="h-4.5 w-4.5 text-[#ffb86b]" /> {title}
      </h2>
      <div className="text-sm leading-relaxed text-zinc-400">{children}</div>
    </section>
  );
}

export default function DMCAPage() {
  return (
    <div className="mx-auto max-w-3xl px-3 py-10 sm:px-4 lg:px-6 animate-fade-up">
      <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#ffb86b]">Legal</p>
      <h1 className="font-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-white">
        <Scale className="h-7 w-7 text-[#ff8a00]" /> DMCA Notice
      </h1>

      <div className="mt-8 space-y-5">
        <Section icon={FileWarning} title="Disclaimer">
          <p>
            AHSANIME does not host any video content on its servers. All content is embedded
            from or linked to third-party sources. We are a content aggregator and indexing service
            only.
          </p>
        </Section>

        <Section icon={FileWarning} title="Filing a DMCA Notice">
          <p className="mb-3">
            If you believe your copyrighted work has been linked to or indexed on our platform,
            please provide the following information:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Identification of the copyrighted work claimed to have been infringed</li>
            <li>Identification of the material that is claimed to be infringing, including URLs</li>
            <li>Your contact information (name, address, phone number, email)</li>
            <li>A statement that you have a good faith belief that the use is not authorized</li>
            <li>A statement that the information in the notification is accurate</li>
            <li>Your physical or electronic signature</li>
          </ul>
        </Section>

        <Section icon={Mail} title="Contact">
          <p>
            Send DMCA notices to <strong className="text-zinc-200">inrelam@gmail.com</strong> or
            use our{" "}
            <Link href="/contact" className="font-semibold text-[#ffb86b] hover:underline">
              contact form
            </Link>
            .
          </p>
        </Section>

        <Section icon={Clock3} title="Response Time">
          <p>
            We aim to respond to valid DMCA notices within 48-72 hours. Links or references to
            infringing content will be removed promptly upon verification.
          </p>
        </Section>
      </div>
      <div className="h-10" />
    </div>
  );
}
