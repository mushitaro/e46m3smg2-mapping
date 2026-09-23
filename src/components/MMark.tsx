// The ///M wordmark motif: three slashes, one per brand hue.
//
// The middle slash is indigo-400 (#9B84E8), NOT the logo navy #2B115A — at
// 1.33:1 on black that glyph reads as missing rather than dark. Same
// substitution the header stripe uses.
//
// aria-hidden because a screen reader announcing "slash slash slash" is noise;
// the accessible name reads better without it. tracking-tight so the three read
// as one mark even inside a tracking-widest heading.
export function MMark({ className }: { className?: string }) {
  return (
    <span className={`tracking-tight ${className ?? ""}`} aria-hidden="true">
      <span className="text-blue-500">/</span>
      <span className="text-indigo-400">/</span>
      <span className="text-red-500">/</span>
    </span>
  );
}
