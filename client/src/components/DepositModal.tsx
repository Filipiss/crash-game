import { useEffect, useRef, useState } from "react";
import {
  DEPOSIT_PACKAGES_CENTS,
  MAX_DEPOSIT_CENTS,
  MIN_DEPOSIT_CENTS,
  type DepositRequest,
  type DepositResponse,
  type PaymentMethod,
} from "../../../shared/api.ts";
import { centsToInput, formatCents, parseInputToCents } from "../format.ts";
import { api, ApiError } from "../net/api.ts";

/**
 * Formas de "pagamento" SIMULADAS. Nenhuma pede dado real: escolher uma só
 * muda o rótulo. O servidor apenas credita fichas virtuais.
 */
const METHODS: { id: PaymentMethod; icon: string; label: string; tag?: string }[] = [
  { id: "pix", icon: "⚡", label: "Pix", tag: "Instantâneo" },
  { id: "card", icon: "💳", label: "Cartão de crédito" },
  { id: "crypto", icon: "🪙", label: "Criptomoedas" },
  { id: "giftcard", icon: "🎟️", label: "Gift card" },
];

/** Ilustração de cada pacote: cresce junto com o valor. */
const PACKAGE_ART = ["🪙", "🪙", "💰", "💰", "💎", "💎", "🏆", "👑"];
const SUGGESTED_CODE = "ROCKET";
/** Tempo do "processamento" simulado: dá a sensação de um pagamento de verdade. */
const FAKE_PROCESSING_MS = 1_200;

type Step = { kind: "form" } | { kind: "processing" } | { kind: "done"; result: DepositResponse };

interface Props {
  onClose: () => void;
  /** Faz a recarga pelo App (que trata sessão expirada, erros e trava de clique duplo). */
  onDeposit: (request: DepositRequest) => Promise<DepositResponse | null>;
}

export function DepositModal({ onClose, onDeposit }: Props) {
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [amountText, setAmountText] = useState(centsToInput(DEPOSIT_PACKAGES_CENTS[0]!));
  const [codeText, setCodeText] = useState("");
  const [promo, setPromo] = useState<{ code: string; percent: number } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "form" });
  const closeRef = useRef<HTMLButtonElement>(null);

  const amountCents = parseInputToCents(amountText);
  let amountError: string | null = null;
  if (amountCents === null) amountError = "Valor inválido";
  else if (amountCents < MIN_DEPOSIT_CENTS) amountError = `Mínimo ${formatCents(MIN_DEPOSIT_CENTS)}`;
  else if (amountCents > MAX_DEPOSIT_CENTS) amountError = `Máximo ${formatCents(MAX_DEPOSIT_CENTS)}`;

  // Prévia do bônus (UX). O valor que vale é o que o SERVIDOR calcular.
  const bonusPreview = (cents: number) => (promo ? Math.floor((cents * promo.percent) / 100) : 0);

  // Acessibilidade e comportamento de modal: Esc fecha, foco inicial no "X",
  // e a página de trás não rola enquanto o modal está aberto.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  async function activatePromo() {
    const code = codeText.trim();
    if (!code) return;
    setCheckingPromo(true);
    setPromoError(null);
    try {
      const res = await api.checkPromo(code);
      setPromo({ code: res.code, percent: res.bonusPercent });
    } catch (err) {
      setPromo(null);
      setPromoError(err instanceof ApiError && err.code === "INVALID_PROMO" ? "Código inválido" : "Não foi possível validar agora");
    } finally {
      setCheckingPromo(false);
    }
  }

  async function pay() {
    if (amountCents === null || amountError) return;
    setStep({ kind: "processing" });
    // O pedido e a "espera do gateway" correm em paralelo; mostramos o resultado após os dois.
    const [result] = await Promise.all([
      onDeposit({ amountCents, method, promoCode: promo?.code ?? null }),
      new Promise((resolve) => setTimeout(resolve, FAKE_PROCESSING_MS)),
    ]);
    setStep(result ? { kind: "done", result } : { kind: "form" });
  }

  return (
    // Clicar no fundo escuro fecha; clicar dentro do modal não (stopPropagation).
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="deposit-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2 id="deposit-title">Recarregue sua conta</h2>
            <p>Escolha uma forma de pagamento e recarregue seu saldo de fichas.</p>
          </div>
          <button ref={closeRef} type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>

        {step.kind === "done" ? (
          <div className="deposit-done">
            <div className="done-icon" aria-hidden>
              ✅
            </div>
            <h3>Recarga concluída!</h3>
            <p className="done-amount">
              +{formatCents(step.result.depositedCents)}
              {step.result.bonusCents > 0 && <span className="bonus-tag">+ {formatCents(step.result.bonusCents)} bônus</span>}
            </p>
            <p className="muted">Novo saldo: {formatCents(step.result.player.balanceCents)}</p>
            <button type="button" className="pay-btn" onClick={onClose}>
              Voltar ao jogo
            </button>
          </div>
        ) : (
          <div className="modal-body">
            <nav className="methods" aria-label="Forma de pagamento">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`method ${method === m.id ? "active" : ""}`}
                  onClick={() => setMethod(m.id)}
                  aria-pressed={method === m.id}
                >
                  {m.tag && <span className="method-tag">⚡ {m.tag}</span>}
                  <span className="method-icon" aria-hidden>
                    {m.icon}
                  </span>
                  <span className="method-label">{m.label}</span>
                </button>
              ))}
            </nav>

            <div className="deposit-main">
              <div className="promo-banner">
                <span className="promo-mascot" aria-hidden>
                  🚀
                </span>
                <p className="promo-text">
                  O código <strong>{SUGGESTED_CODE}</strong> dá <strong>bônus de 10%</strong> na recarga
                </p>
                <div className="promo-form">
                  {promo ? (
                    <span className="promo-active">
                      ✓ {promo.code} ativo · +{promo.percent}%
                      <button type="button" onClick={() => setPromo(null)} aria-label="Remover código">
                        ✕
                      </button>
                    </span>
                  ) : (
                    <>
                      <input
                        value={codeText}
                        onChange={(e) => setCodeText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void activatePromo()}
                        placeholder="Código"
                        aria-label="Código promocional"
                        aria-invalid={promoError !== null}
                      />
                      <button type="button" onClick={() => void activatePromo()} disabled={!codeText.trim() || checkingPromo}>
                        {checkingPromo ? "…" : "Ativar"}
                      </button>
                    </>
                  )}
                </div>
                {promoError && <span className="promo-error">{promoError}</span>}
              </div>

              <div className="packages-card">
                <div className="packages">
                  {DEPOSIT_PACKAGES_CENTS.map((cents, i) => (
                    <button
                      key={cents}
                      type="button"
                      className={`package ${amountCents === cents ? "active" : ""}`}
                      onClick={() => setAmountText(centsToInput(cents))}
                      aria-pressed={amountCents === cents}
                    >
                      <span className="package-art" style={{ fontSize: 26 + i * 3 }} aria-hidden>
                        {PACKAGE_ART[i]}
                      </span>
                      <span className="package-value">{formatCents(cents)}</span>
                      {promo && <span className="bonus-tag">+ {formatCents(bonusPreview(cents))} bônus</span>}
                    </button>
                  ))}
                </div>

                <label className="deposit-value">
                  <span>Valor</span>
                  <div className="input-row" data-invalid={amountError !== null}>
                    <span className="input-prefix">BRL</span>
                    <input
                      inputMode="decimal"
                      value={amountText}
                      onChange={(e) => setAmountText(e.target.value)}
                      onBlur={() => amountCents !== null && setAmountText(centsToInput(amountCents))}
                      aria-label="Valor da recarga"
                    />
                  </div>
                </label>
                {amountError && <p className="field-error">{amountError}</p>}
              </div>

              <footer className="deposit-footer">
                <div>
                  <span className="muted">Você recebe:</span>
                  <p className="receive">
                    <strong>{formatCents(amountCents ?? 0)}</strong>
                    {promo && amountCents !== null && (
                      <span className="receive-bonus">+ 🎁 {formatCents(bonusPreview(amountCents))}</span>
                    )}
                  </p>
                </div>
                <button type="button" className="pay-btn" onClick={() => void pay()} disabled={amountError !== null || step.kind === "processing"}>
                  {step.kind === "processing" ? "Processando…" : "Pagar"}
                </button>
              </footer>
              <p className="disclaimer">🔒 Simulação: fichas virtuais, sem valor real. Nenhum dado de pagamento é solicitado.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
