import { useEffect, useRef } from "react";
import { TranscriptItem } from "../lib/live/types";

export default function TranscriptView({ items }: { items: TranscriptItem[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="transcript transcript-empty">
        对话字幕会显示在这里
      </div>
    );
  }

  return (
    <div className="transcript">
      {items.map((item) => (
        <div key={item.id} className={`bubble bubble-${item.role}`}>
          <span className="bubble-role">
            {item.role === "user" ? "你" : "AI"}
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
