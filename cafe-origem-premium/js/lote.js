// Página pública do lote: lê o código na URL (/lote/<codigo>) e consulta /api/lotes/<codigo>.
const main = document.getElementById("lotMain");
document.getElementById("year").textContent = new Date().getFullYear();

const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const data = iso => { const [a, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${a}`; };
const dias = n => (n <= 0 ? "hoje" : n === 1 ? "há 1 dia" : `há ${n} dias`);
const NOMES_TORRA = { clara: "Torra clara", media: "Torra média", escura: "Torra escura" };

const FALLBACK_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><rect width='800' height='600' fill='#e9dfce'/></svg>");
document.addEventListener("error", e => {
  if (e.target.tagName === "IMG" && !e.target.dataset.fallback) { e.target.dataset.fallback = "1"; e.target.src = FALLBACK_IMG; }
}, true);

function erro(titulo, texto) {
  document.title = "Lote não encontrado | Café Origem Premium";
  main.innerHTML = `<div class="lot-error"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p>
    <a class="button button-dark" href="/#origem-viva">Consultar outro lote</a></div>`;
}

function situacaoBadge(l) {
  if (l.situacao === "vencido") return '<span class="badge badge-bad">Vencido</span>';
  if (l.situacao === "vence_em_breve") return `<span class="badge badge-warn">${esc(l.situacao_rotulo)}</span>`;
  return '<span class="badge badge-ok">Dentro da validade</span>';
}
function dispBadge(l) {
  if (l.disponibilidade === "esgotado") return '<span class="badge badge-bad">Esgotado</span>';
  if (l.disponibilidade === "poucas_unidades") return '<span class="badge badge-warn">Poucas unidades</span>';
  return '<span class="badge badge-ok">Disponível</span>';
}

function render(l) {
  const p = l.produto;
  const codigo = encodeURIComponent(l.codigo_lote);
  document.title = `${p.nome} · lote ${l.codigo_lote} | Café Origem Premium`;

  const total = Math.max((l.dias_desde_torra + l.dias_para_vencer), 1);
  const pct = Math.min(100, Math.max(0, Math.round((l.dias_desde_torra / total) * 100)));
  const notas = String(p.notas_sensoriais || "").split(";").map(n => n.trim()).filter(Boolean);
  const vencido = l.dias_para_vencer < 0;

  main.innerHTML = `
    <section class="lot-hero">
      <div class="lot-summary">
        <p class="eyebrow"><span></span> Origem Viva · passaporte do lote</p>
        <h1>${esc(p.nome)}</h1>
        <p class="lot-code">Lote ${esc(l.codigo_lote)}</p>
        <p class="lead">${esc(p.descricao || "")}</p>
        <div class="lot-badges">${situacaoBadge(l)} ${dispBadge(l)}
          ${notas.map(n => `<span class="note-pill">${esc(n)}</span>`).join("")}</div>
        <div class="lot-cta">
          <a class="button button-dark" href="/#cafes">Ver na vitrine <span>→</span></a>
          <button class="button button-outline no-print" id="printButton">Imprimir etiqueta</button>
        </div>
      </div>
      <div class="lot-photo">
        <img src="${esc(p.imagem_url || "https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=1200&q=85")}" alt="Café ${esc(p.nome)}">
        ${l.pontuacao != null ? `<div class="lot-score"><strong>${Number(l.pontuacao).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong><span>pontos</span></div>` : ""}
      </div>
    </section>

    <section class="lot-grid">
      <div class="lot-card">
        <h2>Da fazenda à sua xícara</h2>
        <dl class="lot-facts">
          <div><dt>Produtor</dt><dd>${esc(l.produtor)}</dd></div>
          <div><dt>Fazenda</dt><dd>${esc(l.fazenda)}</dd></div>
          <div><dt>Origem</dt><dd>${esc(l.origem)}</dd></div>
          <div><dt>Processo</dt><dd>${esc(l.processo)}</dd></div>
          <div><dt>Torra</dt><dd>${esc(NOMES_TORRA[String(p.torra).toLowerCase()] || "—")}</dd></div>
          <div><dt>Embalagem</dt><dd>${esc(p.peso || "—")}</dd></div>
        </dl>
        <div class="shelf">
          <div class="shelf-head"><span>Frescor do lote</span><b>${vencido ? "Fora da validade" : `Torrado ${dias(l.dias_desde_torra)}`}</b></div>
          <div class="shelf-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Porcentagem da validade já decorrida">
            <i class="${pct > 70 ? "warn" : ""}" style="width:${pct}%"></i></div>
          <p class="shelf-note">${vencido
            ? "A validade deste lote já passou."
            : `${l.dias_para_vencer} dia(s) até o vencimento. Para o melhor sabor, consuma nas primeiras semanas após a torra.`}</p>
        </div>
      </div>

      <div class="lot-side">
        <div class="lot-card">
          <h2>Linha do tempo</h2>
          <ol class="timeline">
            <li class="done"><b>Cultivo e processo</b><span>${esc(l.fazenda)} · ${esc(l.processo)}</span></li>
            <li class="done"><b>Torra</b><span>${data(l.data_torra)} (${dias(l.dias_desde_torra)})</span></li>
            <li class="${vencido ? "done" : ""}"><b>Validade</b><span>${data(l.data_validade)}</span></li>
          </ol>
        </div>
        <div class="lot-card qr-card">
          <h2>QR Code deste lote</h2>
          <img src="/api/lotes/${codigo}/qrcode.png" alt="QR Code do lote ${esc(l.codigo_lote)}">
          <p>Escaneie para abrir esta página no celular.</p>
          <p class="url">${esc(l.url_publica)}</p>
        </div>
      </div>
    </section>
    <p class="lot-disclaimer">Os dados desta página foram cadastrados pela torrefação e podem ser atualizados a qualquer momento.</p>`;

  document.getElementById("printButton").addEventListener("click", () => window.print());
}

async function iniciar() {
  const codigo = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop() || "");
  if (!codigo) return erro("Código do lote ausente", "Use o link do QR Code ou digite o código na vitrine.");
  try {
    const resposta = await fetch(`/api/lotes/${encodeURIComponent(codigo)}`);
    if (resposta.status === 404) return erro("Lote não encontrado", `Não existe um lote com o código “${codigo}”. Confira o código impresso na embalagem.`);
    if (!resposta.ok) throw new Error(`Erro ${resposta.status}`);
    render(await resposta.json());
  } catch (e) {
    console.error(e);
    erro("Não foi possível carregar o lote", "Tente novamente em instantes.");
  }
}
iniciar();
