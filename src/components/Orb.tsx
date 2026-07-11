import { useEffect, useRef } from "react";

// ChatGPT-Live-style breathing orb. Scales/glows with whoever is speaking:
// remote stream (assistant) drives the blue glow, mic drives the ring.
export default function Orb({
  localStream,
  remoteStream,
  active,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  active: boolean;
}) {
  const orbRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const ctx = new AudioContext();
    let raf = 0;

    const makeAnalyser = (stream: MediaStream | null) => {
      if (!stream || stream.getAudioTracks().length === 0) return null;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    };

    const level = (analyser: AnalyserNode | null) => {
      if (!analyser) return 0;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      return Math.min(1, Math.sqrt(sum / data.length) * 4);
    };

    let localAnalyser = makeAnalyser(localStream);
    let remoteAnalyser = makeAnalyser(remoteStream);
    let lastRemote = remoteStream;

    const tick = () => {
      // The remote stream appears after connect; pick it up lazily.
      if (remoteStream !== lastRemote) {
        remoteAnalyser = makeAnalyser(remoteStream);
        lastRemote = remoteStream;
      }
      const out = level(remoteAnalyser);
      const inp = level(localAnalyser);
      if (orbRef.current) {
        orbRef.current.style.transform = `scale(${1 + out * 0.35})`;
        orbRef.current.style.filter = `brightness(${1 + out * 0.6})`;
      }
      if (ringRef.current) {
        ringRef.current.style.transform = `scale(${1.15 + inp * 0.45})`;
        ringRef.current.style.opacity = `${0.25 + inp * 0.75}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ctx.close();
    };
  }, [active, localStream, remoteStream]);

  return (
    <div className={`orb-wrap ${active ? "orb-active" : ""}`}>
      <div ref={ringRef} className="orb-ring" />
      <div ref={orbRef} className="orb" />
    </div>
  );
}
