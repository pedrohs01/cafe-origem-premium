// Café Origem Premium — vitrine
// Dados vêm da API Flask (/api/produtos e /api/origem-viva). Nenhum dado é fixo no navegador.

let products = [];
let lots = [];
const cart = new Map();

const $ = id => document.getElementById(id);
const productGrid = $("productGrid");
const searchInput = $("searchInput");
const roastFilter = $("roastFilter");
const profileFilter = $("profileFilter");
const sortSelect = $("sortSelect");
const emptyState = $("emptyState");
const catalogCount = $("catalogCount");
const toast = $("toast");

const FALLBACK_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='500'><rect width='600' height='500' fill='#e9dfce'/>" +
  "<g fill='none' stroke='#7a5640' stroke-width='6' stroke-linecap='round' opacity='.55'><ellipse cx='300' cy='255' rx='62' ry='84' transform='rotate(35 300 255)'/>" +
  "<path d='M262 300c40-30 36-70 76-90'/></g></svg>");

// ---------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------
const money = value => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Escapa texto vindo do banco antes de colocar em innerHTML (evita injeção de HTML/script).
const esc = valor => String(valor ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const formatarData = iso => {
  if (!iso) return "Não informada";
  const [ano, mes, dia] = String(iso).slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : String(iso);
};

const diasDesde = iso => {
  if (!iso) return null;
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const hoje = new Date();
  const base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((base - Date.UTC(a, m - 1, d)) / 86400000);
};

const textoDias = n => n === null || n === undefined ? "" : n <= 0 ? "hoje" : n === 1 ? "há 1 dia" : `há ${n} dias`;
const pontos = n => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function lerArmazenamento(chave) {
  try { return JSON.parse(localStorage.getItem(chave)); } catch { return null; }
}
function gravarArmazenamento(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* modo privado: ignora */ }
}

// Imagem quebrada vira um placeholder neutro (vale para todas as <img> da página).
document.addEventListener("error", event => {
  const img = event.target;
  if (img.tagName === "IMG" && !img.dataset.fallback) {
    img.dataset.fallback = "1";
    img.src = FALLBACK_IMG;
  }
}, true);

// ---------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------
const NOMES_TORRA = { clara: "Torra clara", media: "Torra média", "média": "Torra média", escura: "Torra escura" };

function adaptarProduto(item) {
  const torra = (item.torra || "media").toLowerCase();
  const lote = item.lote || null;
  return {
    id: Number(item.id),
    name: item.nome,
    origin: item.origem || "Origem a cadastrar",
    price: Number(item.preco),
    weight: item.peso || "250 g",
    roast: torra,
    roastLabel: NOMES_TORRA[torra] || "Torra a cadastrar",
    profiles: (item.perfil_sensorial || "").split(",").map(p => p.trim().toLowerCase()).filter(Boolean),
    notes: (item.notas_sensoriais || "Café especial").split(";").map(n => n.trim()).filter(Boolean),
    tag: item.tag || "Café especial",
    image: item.imagem_url || "https://images.unsplash.com/photo-1442512595331-e89e73853f31?auto=format&fit=crop&w=900&q=85",
    description: item.descricao || "Café especial da linha Café Origem Premium.",
    stock: item.estoque_total === null || item.estoque_total === undefined ? null : Number(item.estoque_total),
    lot: lote,
    score: lote && lote.pontuacao != null ? Number(lote.pontuacao) : null,
    freshDays: lote ? lote.dias_desde_torra : null
  };
}

// Situação de estoque: null = sem lote cadastrado (vende normalmente, sem selo).
function disponibilidade(p) {
  if (p.stock === null) return null;
  if (p.stock <= 0) return { classe: "badge-bad", texto: "Esgotado", esgotado: true };
  if (p.stock <= 10) return { classe: "badge-warn", texto: p.stock === 1 ? "Resta 1" : `Restam ${p.stock}`, esgotado: false };
  return { classe: "badge-ok", texto: "Disponível", esgotado: false };
}

const maxQuantidade = p => (p.stock === null ? 99 : Math.max(p.stock, 0));

async function carregarProdutos() {
  productGrid.innerHTML = '<div class="skeleton"></div>'.repeat(3);
  catalogCount.textContent = "Carregando…";
  emptyState.classList.add("hidden");
  productGrid.classList.remove("hidden");

  try {
    const resposta = await fetch("/api/produtos");
    if (!resposta.ok) throw new Error("A API não conseguiu consultar os produtos.");
    const dados = await resposta.json();
    if (!Array.isArray(dados)) throw new Error("A resposta da API está em formato inesperado.");
    products = dados.map(adaptarProduto);
    restaurarSacola();
    renderProducts();
    renderStats();
  } catch (erro) {
    console.error("Erro ao carregar produtos:", erro);
    products = [];
    productGrid.innerHTML = "";
    productGrid.classList.add("hidden");
    catalogCount.textContent = "Indisponível";
    $("emptyTitle").textContent = "Não foi possível carregar os cafés";
    $("emptyText").textContent = "Confirme se o servidor Flask e o banco de dados estão funcionando e tente de novo.";
    $("clearFilters").textContent = "Tentar novamente";
    $("clearFilters").dataset.retry = "1";
    emptyState.classList.remove("hidden");
    showToast("Verifique se o servidor Flask está funcionando.");
  }
}

function ordenar(lista) {
  const chave = sortSelect.value;
  const copia = [...lista];
  const ultimo = v => (v === null || v === undefined ? Infinity : v);
  const esgotadoPrimeiro = (a, b) => (disponibilidade(a)?.esgotado ? 1 : 0) - (disponibilidade(b)?.esgotado ? 1 : 0);
  if (chave === "fresco") copia.sort((a, b) => ultimo(a.freshDays) - ultimo(b.freshDays));
  else if (chave === "pontuacao") copia.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  else if (chave === "menor") copia.sort((a, b) => a.price - b.price);
  else if (chave === "maior") copia.sort((a, b) => b.price - a.price);
  else copia.sort(esgotadoPrimeiro);   // destaque: mantém a ordem da API, esgotados no fim
  return copia;
}

function cardHTML(p) {
  const disp = disponibilidade(p);
  const esgotado = Boolean(disp && disp.esgotado);
  const frescor = p.lot
    ? `<div class="fresh-line"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
         <span>Torrado <b>${textoDias(p.freshDays)}</b> · lote ${esc(p.lot.codigo_lote)}</span></div>`
    : `<div class="fresh-line"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
         <span>${esgotado ? "Sem lote disponível no momento" : "Lote em preparação"}</span></div>`;

  return `
    <article class="product-card ${esgotado ? "is-soldout" : ""}">
      <div class="product-image-wrap">
        <img class="product-image" src="${esc(p.image)}" alt="Café especial ${esc(p.name)}" loading="lazy">
        <span class="product-tag">${esc(p.tag)}</span>
        ${p.score !== null ? `<span class="product-score" title="Pontuação do lote">${pontos(p.score)} pts</span>` : ""}
        <button class="quick-view" data-view="${p.id}">Conhecer este café</button>
      </div>
      <div class="product-body">
        <div class="product-meta"><h3>${esc(p.name)}</h3><span class="product-price">${money(p.price)}</span></div>
        <p class="product-origin">${esc(p.origin)} · ${esc(p.weight)} · ${esc(p.roastLabel)}</p>
        <div class="product-notes">${p.notes.map(n => `<span class="note-pill">${esc(n)}</span>`).join("")}</div>
        ${frescor}
        <div class="product-bottom">
          ${disp ? `<span class="badge ${disp.classe}">${esc(disp.texto)}</span>` : `<small>${esc(p.roastLabel)}</small>`}
          <button class="add-button" data-add="${p.id}" ${esgotado ? "disabled" : ""} aria-label="Adicionar ${esc(p.name)} à sacola">
            ${esgotado ? "Indisponível" : "Adicionar"}
          </button>
        </div>
      </div>
    </article>`;
}

function renderProducts() {
  const termo = searchInput.value.trim().toLocaleLowerCase("pt-BR");
  const torra = roastFilter.value;
  const perfil = profileFilter.value;

  const filtrados = products.filter(p => {
    const texto = [p.name, p.origin, ...p.notes, p.roastLabel, p.description].join(" ").toLocaleLowerCase("pt-BR");
    return texto.includes(termo) && (!torra || p.roast === torra) && (!perfil || p.profiles.includes(perfil));
  });

  catalogCount.textContent = `${filtrados.length} ${filtrados.length === 1 ? "café" : "cafés"}`;
  emptyState.classList.toggle("hidden", filtrados.length !== 0);
  productGrid.classList.toggle("hidden", filtrados.length === 0);

  if (filtrados.length === 0) {
    const semProdutos = products.length === 0;
    $("emptyTitle").textContent = semProdutos ? "Nenhum café cadastrado ainda" : "Nenhum café encontrado";
    $("emptyText").textContent = semProdutos
      ? "Cadastre cafés na área administrativa para exibi-los aqui."
      : "Tente mudar a busca ou remover algum filtro.";
    $("clearFilters").textContent = "Limpar filtros";
    delete $("clearFilters").dataset.retry;
  }
  productGrid.innerHTML = ordenar(filtrados).map(cardHTML).join("");
}

// Números do topo da página: calculados com os dados reais do banco.
function renderStats() {
  $("statCafes").textContent = products.length || "—";
  $("statLotes").textContent = lots.length || "—";
  const notas = lots.map(l => Number(l.pontuacao)).filter(Number.isFinite);
  $("statScore").textContent = notas.length ? pontos(notas.reduce((a, b) => a + b, 0) / notas.length) : "—";
  const dias = lots.map(l => diasDesde(l.data_torra)).filter(d => d !== null);
  $("statFresh").textContent = dias.length ? (Math.min(...dias) <= 0 ? "hoje" : `${Math.min(...dias)} d`) : "—";
}

// ---------------------------------------------------------------
// Mensagens e sacola (salva no navegador)
// ---------------------------------------------------------------
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function salvarSacola() {
  gravarArmazenamento("co_sacola", [...cart.entries()]);
}

function restaurarSacola() {
  cart.clear();
  (lerArmazenamento("co_sacola") || []).forEach(([id, qty]) => {
    const p = products.find(item => item.id === Number(id));
    const q = Math.min(Number(qty) || 0, p ? maxQuantidade(p) : 0);
    if (p && q > 0) cart.set(p.id, q);
  });
  salvarSacola();
  updateCartCount();
}

function updateCartCount() {
  $("cartCount").textContent = [...cart.values()].reduce((s, q) => s + q, 0);
}

function addToCart(id) {
  const p = products.find(item => item.id === id);
  if (!p) return;
  const atual = cart.get(id) || 0;
  if (atual >= maxQuantidade(p)) {
    showToast(maxQuantidade(p) === 0 ? `${p.name} está esgotado.` : `Só há ${maxQuantidade(p)} unidade(s) de ${p.name} em estoque.`);
    return;
  }
  cart.set(id, atual + 1);
  salvarSacola();
  updateCartCount();
  showToast(`${p.name} foi adicionado à sacola.`);
}

function renderCart() {
  const container = $("cartItems");
  const entradas = [...cart.entries()].filter(([id]) => products.some(p => p.id === id));

  container.innerHTML = entradas.length
    ? entradas.map(([id, qty]) => {
        const p = products.find(item => item.id === id);
        return `
          <div class="cart-row">
            <div><strong>${esc(p.name)}</strong><small>${qty} × ${money(p.price)} · ${esc(p.weight)}</small></div>
            <div class="cart-qty">
              <button data-qty="-1" data-id="${id}" aria-label="Diminuir quantidade">−</button>
              <span>${qty}</span>
              <button data-qty="1" data-id="${id}" aria-label="Aumentar quantidade" ${qty >= maxQuantidade(p) ? "disabled" : ""}>+</button>
            </div>
          </div>`;
      }).join("")
    : '<p class="modal-lead">Sua sacola ainda está vazia. Explore nossos cafés para escolher o seu.</p>';

  const total = entradas.reduce((soma, [id, qty]) => soma + products.find(p => p.id === id).price * qty, 0);
  $("cartTotal").textContent = money(total);
  $("checkoutButton").disabled = entradas.length === 0;
}

// ---------------------------------------------------------------
// Detalhes do café
// ---------------------------------------------------------------
function showProduct(id) {
  const p = products.find(item => item.id === id);
  if (!p) return;
  const disp = disponibilidade(p);
  const esgotado = Boolean(disp && disp.esgotado);
  const l = p.lot;

  const blocoLote = l ? `
    <div class="lot-box">
      <h4>Lote à venda <span class="badge ${disp ? disp.classe : "badge-ok"}">${esc(disp ? disp.texto : "Disponível")}</span></h4>
      <dl>
        <div><dt>Código</dt><dd>${esc(l.codigo_lote)}</dd></div>
        <div><dt>Pontuação</dt><dd>${l.pontuacao != null ? `${pontos(l.pontuacao)} pts` : "—"}</dd></div>
        <div><dt>Torra</dt><dd>${formatarData(l.data_torra)} (${textoDias(l.dias_desde_torra)})</dd></div>
        <div><dt>Validade</dt><dd>${formatarData(l.data_validade)}</dd></div>
        <div><dt>Produtor</dt><dd>${esc(l.produtor || "—")}</dd></div>
        <div><dt>Processo</dt><dd>${esc(l.processo || "—")}</dd></div>
      </dl>
      <a href="/lote/${encodeURIComponent(l.codigo_lote)}">Abrir a página do lote (QR Code) →</a>
    </div>`
    : `<div class="lot-box"><h4>Rastreabilidade</h4><p class="modal-lead" style="margin:0">${esgotado ? "Este café está sem lote disponível no momento." : "Ainda não há lote cadastrado para este café."}</p></div>`;

  $("productModalContent").innerHTML = `
    <div class="modal-product">
      <div class="modal-product-media"><img class="modal-product-image" src="${esc(p.image)}" alt="Café ${esc(p.name)}"></div>
      <div class="modal-product-info">
        <p class="eyebrow">${esc(p.origin)}</p>
        <h2>${esc(p.name)}</h2>
        <p class="modal-lead">${esc(p.description)}</p>
        <div class="product-notes">${p.notes.map(n => `<span class="note-pill">${esc(n)}</span>`).join("")}</div>
        ${blocoLote}
        <div class="modal-price"><strong>${money(p.price)}</strong><span>${esc(p.weight)} · ${esc(p.roastLabel)}</span></div>
        <button class="button button-dark full-width" data-modal-add="${p.id}" ${esgotado ? "disabled" : ""}>
          ${esgotado ? "Indisponível" : "Adicionar à sacola"} <span>+</span>
        </button>
      </div>
    </div>`;
  $("productModal").showModal();
}

// ---------------------------------------------------------------
// Origem Viva — passaporte do lote com QR Code real
// ---------------------------------------------------------------
let loteAtivo = 0;

async function carregarOrigemViva() {
  try {
    const resposta = await fetch("/api/origem-viva");
    if (!resposta.ok) throw new Error(`Erro ${resposta.status}`);
    const dados = await resposta.json();
    if (!Array.isArray(dados)) throw new Error("Formato inesperado");
    lots = dados;
  } catch (erro) {
    console.error("Erro ao consultar Origem Viva:", erro);
    lots = [];
    $("passport").innerHTML = '<div class="passport-empty">Não foi possível carregar os lotes agora. Confira se o servidor está no ar.</div>';
    renderStats();
    return;
  }
  renderStats();
  renderPassport();
}

function renderPassport() {
  const box = $("passport");
  if (!lots.length) {
    box.innerHTML = '<div class="passport-empty"><strong>Nenhum lote cadastrado ainda.</strong><br>Cadastre um lote na área administrativa e o QR Code aparece aqui.</div>';
    return;
  }
  const l = lots[Math.min(loteAtivo, lots.length - 1)];
  const dias = diasDesde(l.data_torra);
  const codigo = encodeURIComponent(l.codigo_lote);

  box.innerHTML = `
    <div class="passport-head"><p class="eyebrow">Passaporte do lote</p><span class="badge badge-ok">Dados reais do banco</span></div>
    <div class="passport-body">
      <div>
        <h3>${esc(l.cafe)}</h3>
        <p class="passport-code">Lote ${esc(l.codigo_lote)}</p>
        <dl class="passport-facts">
          <div><dt>Produtor</dt><dd>${esc(l.produtor)}</dd></div>
          <div><dt>Fazenda</dt><dd>${esc(l.fazenda)}</dd></div>
          <div><dt>Origem</dt><dd>${esc(l.origem)}</dd></div>
          <div><dt>Processo</dt><dd>${esc(l.processo)}</dd></div>
          <div><dt>Torra</dt><dd>${formatarData(l.data_torra)}${dias !== null ? ` · ${textoDias(dias)}` : ""}</dd></div>
          <div><dt>Pontuação</dt><dd>${l.pontuacao != null ? `${pontos(l.pontuacao)} pts` : "—"}</dd></div>
        </dl>
      </div>
      <div class="qr-box">
        <img src="/api/lotes/${codigo}/qrcode.png" alt="QR Code do lote ${esc(l.codigo_lote)}" width="156" height="156">
        <small>Escaneie para abrir a página pública do lote</small>
      </div>
    </div>
    <div class="passport-foot">
      <a class="button button-dark" href="/lote/${codigo}">Abrir página do lote <span>→</span></a>
    </div>
    ${lots.length > 1 ? `<div class="lot-chips" role="tablist" aria-label="Escolher outro lote">${
      lots.slice(0, 6).map((x, i) => `<button class="lot-chip ${i === loteAtivo ? "active" : ""}" data-lot="${i}" role="tab" aria-selected="${i === loteAtivo}">${esc(x.codigo_lote)}</button>`).join("")
    }</div>` : ""}`;
}

$("passport").addEventListener("click", event => {
  const chip = event.target.closest("[data-lot]");
  if (!chip) return;
  loteAtivo = Number(chip.dataset.lot);
  renderPassport();
});

$("lotLookup").addEventListener("submit", event => {
  event.preventDefault();
  const codigo = $("lotCodeInput").value.trim();
  if (codigo) window.location.href = `/lote/${encodeURIComponent(codigo)}`;
});

// ---------------------------------------------------------------
// Perfil de café — recomendação explicável
// ---------------------------------------------------------------
const PERFIS = {
  chocolate: { icone: "🍫", nome: "Achocolatado", desc: "Chocolate, caramelo e castanhas" },
  frutado: { icone: "🍊", nome: "Frutado", desc: "Frutas, acidez viva e doçura" },
  floral: { icone: "🌼", nome: "Floral", desc: "Aromas delicados e chá" }
};
const TORRAS = {
  clara: { icone: "🌤️", nome: "Torra clara", desc: "Mais acidez e notas delicadas" },
  media: { icone: "⛅", nome: "Torra média", desc: "Equilíbrio entre doçura e corpo" },
  escura: { icone: "🌑", nome: "Torra escura", desc: "Corpo intenso e amargor marcante" },
  qualquer: { icone: "✨", nome: "Tanto faz", desc: "Deixe a escolha com a plataforma" }
};
const METODOS = {
  espresso: { icone: "☕", nome: "Espresso ou moka", desc: "Extração sob pressão ou fogão", torras: ["media", "escura"], dica: "Moagem fina. No espresso, mire em 25–30 s de extração." },
  coador: { icone: "🫗", nome: "Coador de papel ou V60", desc: "Filtrado, mais limpo e aromático", torras: ["clara", "media"], dica: "Moagem média e água a cerca de 92 °C, na proporção de 1 g de café para 15 mL de água." },
  prensa: { icone: "🫖", nome: "Prensa francesa", desc: "Infusão, mais corpo", torras: ["media", "escura"], dica: "Moagem grossa e cerca de 4 minutos de infusão antes de pressionar." },
  qualquer: { icone: "🤷", nome: "Varia ou ainda não sei", desc: "Sem preferência de método", torras: [], dica: "Comece pelo coador de papel: é simples e valoriza as notas do café." }
};

let quiz = { passo: 0, perfil: null, torra: null, metodo: null };
const PASSOS = [
  { chave: "perfil", pergunta: "Que sabores combinam com você?", dica: "Escolha o perfil que mais chama a sua atenção.", opcoes: PERFIS },
  { chave: "torra", pergunta: "Qual torra você prefere?", dica: "Se não tem certeza, escolha “Tanto faz”.", opcoes: TORRAS },
  { chave: "metodo", pergunta: "Como você costuma preparar?", dica: "Isso ajuda a indicar a torra mais adequada.", opcoes: METODOS }
];

function abrirQuiz() {
  quiz = { passo: 0, perfil: null, torra: null, metodo: null };
  renderQuiz();
  $("quizModal").showModal();
}

function renderQuiz() {
  const alvo = $("quizContent");
  if (quiz.passo >= PASSOS.length) return renderRecomendacoes(alvo);

  const passo = PASSOS[quiz.passo];
  alvo.innerHTML = `
    <p class="eyebrow">Meu perfil de café · passo ${quiz.passo + 1} de ${PASSOS.length}</p>
    <div class="quiz-progress" aria-hidden="true">${PASSOS.map((_, i) => `<i class="${i <= quiz.passo ? "done" : ""}"></i>`).join("")}</div>
    <h2 class="quiz-question">${passo.pergunta}</h2>
    <p class="quiz-hint">${passo.dica}</p>
    <div class="choice-list">
      ${Object.entries(passo.opcoes).map(([valor, o]) => `
        <button class="choice" data-choice="${valor}">
          <span class="choice-icon">${o.icone}</span><strong>${o.nome}</strong><small>${o.desc}</small>
        </button>`).join("")}
    </div>
    ${quiz.passo > 0 ? '<div class="quiz-nav"><button class="button button-outline button-sm" data-quiz-back>← Voltar</button></div>' : ""}`;
}

// Pontua cada café e guarda os MOTIVOS, para que a sugestão seja explicável.
function pontuarCafe(p) {
  let pontosTotal = 0, maximo = 0;
  const motivos = [];

  maximo += 4;
  if (quiz.perfil && p.profiles.includes(quiz.perfil)) {
    pontosTotal += 4;
    motivos.push(`Perfil ${PERFIS[quiz.perfil].nome.toLowerCase()}, como você escolheu`);
  }
  if (quiz.torra && quiz.torra !== "qualquer") {
    maximo += 3;
    if (p.roast === quiz.torra) { pontosTotal += 3; motivos.push(`${p.roastLabel}, a sua preferida`); }
  }
  const metodo = METODOS[quiz.metodo];
  if (metodo && metodo.torras.length) {
    maximo += 2;
    if (metodo.torras.includes(p.roast)) { pontosTotal += 2; motivos.push(`Combina com ${metodo.nome}`); }
  }
  maximo += 1;
  if (p.freshDays !== null && p.freshDays <= 14) { pontosTotal += 1; motivos.push(`Torrado ${textoDias(p.freshDays)}`); }
  maximo += 1;
  if (p.score !== null && p.score >= 85) { pontosTotal += 1; motivos.push(`Pontuação ${pontos(p.score)} pts`); }

  return { p, motivos, pct: Math.round((pontosTotal / maximo) * 100), pontos: pontosTotal };
}

function renderRecomendacoes(alvo) {
  const ranking = products
    .filter(p => !(disponibilidade(p)?.esgotado))
    .map(pontuarCafe)
    .filter(r => r.motivos.length > 0)
    .sort((a, b) => b.pontos - a.pontos || (a.p.freshDays ?? 999) - (b.p.freshDays ?? 999))
    .slice(0, 3);

  const metodo = METODOS[quiz.metodo];
  alvo.innerHTML = `
    <p class="eyebrow">Resultado · seu perfil: ${esc(PERFIS[quiz.perfil].nome.toLowerCase())}</p>
    <h2 class="quiz-question">${ranking.length ? "Cafés feitos para você" : "Ainda não temos um café ideal"}</h2>
    <p class="quiz-hint">${ranking.length
      ? "Mostramos os motivos de cada indicação, para você decidir com clareza."
      : "Nenhum café disponível combina com essas respostas. Tente outro perfil ou veja todo o catálogo."}</p>
    <div class="rec-list">
      ${ranking.map(r => `
        <div class="rec-card">
          <img src="${esc(r.p.image)}" alt="" loading="lazy">
          <div>
            <div class="rec-top"><h4>${esc(r.p.name)}</h4><span class="rec-match">${r.pct}% compatível</span></div>
            <ul class="rec-reasons">${r.motivos.map(m => `<li>${esc(m)}</li>`).join("")}</ul>
            <div class="rec-actions"><strong>${money(r.p.price)}</strong>
              <span><button class="button button-dark button-sm" data-rec-add="${r.p.id}">Adicionar</button></span></div>
          </div>
        </div>`).join("")}
    </div>
    ${metodo ? `<p class="rec-brew"><b>Dica de preparo (${esc(metodo.nome)}):</b> ${esc(metodo.dica)} Sugestão geral; ajuste ao seu gosto.</p>` : ""}
    <div class="quiz-nav">
      <button class="button button-outline button-sm" data-quiz-restart>Refazer</button>
      <a class="button button-sm button-dark" href="#cafes" data-quiz-close>Ver todo o catálogo</a>
    </div>`;
}

$("quizModal").addEventListener("click", event => {
  const escolha = event.target.closest("[data-choice]");
  if (escolha) {
    quiz[PASSOS[quiz.passo].chave] = escolha.dataset.choice;
    quiz.passo += 1;
    renderQuiz();
    return;
  }
  if (event.target.closest("[data-quiz-back]")) { quiz.passo = Math.max(0, quiz.passo - 1); renderQuiz(); return; }
  if (event.target.closest("[data-quiz-restart]")) { abrirQuiz(); return; }
  const adicionar = event.target.closest("[data-rec-add]");
  if (adicionar) { addToCart(Number(adicionar.dataset.recAdd)); return; }
  if (event.target.closest("[data-quiz-close]")) $("quizModal").close();
});

$("profileButton").addEventListener("click", abrirQuiz);

// ---------------------------------------------------------------
// Eventos gerais
// ---------------------------------------------------------------
productGrid.addEventListener("click", event => {
  const add = event.target.closest("[data-add]");
  const view = event.target.closest("[data-view]");
  if (add) addToCart(Number(add.dataset.add));
  if (view) showProduct(Number(view.dataset.view));
});

[searchInput, roastFilter, profileFilter, sortSelect].forEach(el => {
  el.addEventListener(el === searchInput ? "input" : "change", renderProducts);
});

$("clearFilters").addEventListener("click", event => {
  if (event.currentTarget.dataset.retry) {
    carregarProdutos();
    carregarOrigemViva();
    return;
  }
  searchInput.value = "";
  roastFilter.value = "";
  profileFilter.value = "";
  sortSelect.value = "relevancia";
  renderProducts();
});

$("searchFocus").addEventListener("click", () => {
  $("cafes").scrollIntoView({ behavior: "smooth" });
  window.setTimeout(() => searchInput.focus({ preventScroll: true }), 400);
});

$("cartButton").addEventListener("click", () => {
  renderCart();
  $("cartModal").showModal();
});

$("cartItems").addEventListener("click", event => {
  const botao = event.target.closest("[data-qty]");
  if (!botao) return;
  const id = Number(botao.dataset.id);
  const p = products.find(item => item.id === id);
  const proximo = (cart.get(id) || 0) + Number(botao.dataset.qty);
  if (proximo <= 0) cart.delete(id);
  else if (p && proximo <= maxQuantidade(p)) cart.set(id, proximo);
  salvarSacola();
  updateCartCount();
  renderCart();
});

$("checkoutButton").addEventListener("click", () => {
  showToast("Checkout demonstrativo: os pedidos reais serão implementados depois.");
});

$("productModalContent").addEventListener("click", event => {
  const botao = event.target.closest("[data-modal-add]");
  if (!botao) return;
  addToCart(Number(botao.dataset.modalAdd));
  $("productModal").close();
});

$("newsletterForm").addEventListener("submit", event => {
  event.preventDefault();
  const email = $("emailInput").value.trim();
  $("newsletterMessage").textContent = `Obrigado! ${email} foi validado apenas nesta demonstração; nenhum cadastro foi enviado.`;
  event.target.reset();
});

document.querySelectorAll("[data-close]").forEach(botao => {
  botao.addEventListener("click", () => botao.closest("dialog").close());
});
document.querySelectorAll("dialog").forEach(dialogo => {
  dialogo.addEventListener("click", event => { if (event.target === dialogo) dialogo.close(); });
});

// Menu do celular
const menuToggle = $("menuToggle");
const mainNav = $("mainNav");
function fecharMenu() {
  mainNav.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
}
menuToggle.addEventListener("click", () => {
  const aberto = mainNav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(aberto));
});
mainNav.querySelectorAll("a").forEach(link => link.addEventListener("click", fecharMenu));
window.addEventListener("resize", () => { if (window.innerWidth > 900) fecharMenu(); });

// ---------------------------------------------------------------
// Início
// ---------------------------------------------------------------
$("year").textContent = new Date().getFullYear();
carregarProdutos();
carregarOrigemViva();
