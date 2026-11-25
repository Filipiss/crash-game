/** Cor estável a partir de um texto: o mesmo jogador sempre ganha a mesma cor. */
function hueFrom(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/** "Ada Lovelace" -> "AL" */
function initials(name: string): string {
  const words = name.split(" ").filter((w) => /^\p{Lu}/u.test(w)); // só palavras com maiúscula ("da", "de" ficam de fora)
  return (words.length ? words : [name])
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Avatar gerado (sem imagens): iniciais sobre um gradiente com a cor do jogador. */
export function Avatar({ name, seed, size = 32 }: { name: string; seed: string; size?: number }) {
  const hue = hueFrom(seed);
  return (
    <span
      className="avatar"
      title={name}
      aria-hidden
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue} 65% 48%), hsl(${(hue + 50) % 360} 70% 28%))`,
      }}
    >
      {initials(name)}
    </span>
  );
}
