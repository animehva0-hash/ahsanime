"use client";

import { useLang } from "./providers";
import { cn } from "@/lib/utils";

export default function TitleText({
  romaji,
  english,
  as: Tag = "h1",
  className,
}: {
  romaji: string | null;
  english: string | null;
  as?: "h1" | "h2" | "span";
  className?: string;
}) {
  const { pick } = useLang();
  return (
    <Tag className={cn(className)}>{pick({ romaji, english })}</Tag>
  );
}
