/* eslint-disable @next/next/no-img-element */
/** The KudoBird mark (bird carrying a certificate scroll) and wordmark. */
export function Logo({ size = 28, text = true, className = "" }: { size?: number; text?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-tight ${className}`}>
      <img src="/brand/bird-256.png" alt={text ? "" : "KudoBird"} width={size} height={size} style={{ width: size, height: size }} />
      {text && <span>Kudo<span className="text-orange-500">Bird</span></span>}
    </span>
  );
}
