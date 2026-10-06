export function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="lbl">{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}
