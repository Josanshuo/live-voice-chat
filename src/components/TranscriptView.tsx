import { useEffect, useRef } from "react";
import { TranscriptItem } from "../lib/live/types";
import { t } from "../lib/i18n";

export default function TranscriptView({ items }: { items: TranscriptItem[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="transcript transcript-empty">
        {t("transcript.empty")}
      </div>
    );
  }

  return (
    <div className="transcript">
      {items.map((item) => (
        <div key={item.id} className={`bubble bubble-${item.role}`}>
          <span className="bubble-role">
            {item.role === "user" ? t("role.you") : t("role.ai")}
          </span>
          <span className={item.final ? "" : "bubble-partial"}>
            {item.text || "…"}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
