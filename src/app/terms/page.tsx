import type { Metadata } from "next";
import { ScrollText } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms of Use for AHSANIME.",
};

const SECTIONS: { n: string; title: string; body: string }[] = [
  {
    n: "1",
    title: "Acceptance of Terms",
    body: "By accessing and using AHSANIME, you accept and agree to be bound by the terms and conditions of this agreement. If you do not agree to abide by these terms, please do not use this service.",
  },
  {
    n: "2",
    title: "License",
    body: "AHSANIME grants you a limited, non-exclusive, non-transferable license to access and use the service for personal, non-commercial purposes. This license does not include any resale or commercial use of the service or its contents.",
  },
  {
    n: "3",
    title: "User Conduct",
    body: "You agree not to use the service for any unlawful purpose or in any way that could damage, disable, overburden, or impair the service. You agree not to attempt to gain unauthorized access to any part of the service.",
  },
  {
    n: "4",
    title: "Content Disclaimer",
    body: "AHSANIME does not host any video content on its servers. All content is provided by third-party services. We are not responsible for the accuracy, compliance, copyright, legality, decency, or any other aspect of the content provided by third parties.",
  },
  {
    n: "5",
    title: "Limitation of Liability",
    body: "AHSANIME shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of, or inability to use, the service.",
  },
  {
    n: "6",
    title: "Privacy",
    body: "We respect your privacy. We do not collect personally identifiable information unless voluntarily provided. Cookies may be used to enhance user experience.",
  },
  {
    n: "7",
    title: "Modifications",
    body: "We reserve the right to modify these terms at any time. Changes will be effective immediately upon posting. Your continued use of the service following any changes constitutes acceptance of those changes.",
  },
  {
    n: "8",
    title: "Governing Law",
    body: "These terms shall be governed by and construed in accordance with applicable laws. Any disputes arising from these terms shall be resolved in the appropriate courts.",
  },
  {
    n: "9",
    title: "Contact",
    body: "If you have any questions about these Terms, please contact us at inrelam@gmail.com or through our contact page.",
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-3 py-10 sm:px-4 lg:px-6 animate-fade-up">
      <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#ffb86b]">Legal</p>
      <h1 className="font-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-white">
        <ScrollText className="h-7 w-7 text-[#ff8a00]" /> Terms of Use
      </h1>

      <div className="mt-8 space-y-4">
        {SECTIONS.map((sec) => (
          <section
            key={sec.n}
            className="rounded-2xl border border-white/5 bg-white/[0.02] p-5"
          >
            <h2 className="mb-1.5 flex items-baseline gap-2 text-sm font-semibold text-white">
              <span className="text-[#ffb86b]">{sec.n}.</span> {sec.title}
            </h2>
            <p className="text-sm leading-relaxed text-zinc-400">{sec.body}</p>
          </section>
        ))}
      </div>
      <div className="h-10" />
    </div>
  );
}
