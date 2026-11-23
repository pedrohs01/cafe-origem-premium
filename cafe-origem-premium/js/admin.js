const form = document.getElementById("lotForm");
const productSelect = document.getElementById("produto_id");
const messageBox = document.getElementById("formMessage");
const submitButton = document.getElementById("submitButton");
const submitLabel = submitButton.querySelector(".submit-label");

document.getElementById("year").textContent = new Date().getFullYear();

function mostrarMensagem(tipo, mensagem) {
  messageBox.className = `admin-message ${tipo}`;
  messageBox.textContent = mensagem;
  messageBox.hidden = false;
}

function limparMensagem() {
  messageBox.hidden = true;
  messageBox.textContent = "";
  messageBox.className = "admin-message";
}

// Valida o formato e verifica se a data existe no calendário.
function dataValida(valor) {
  if (typeof valor !== "string") {
    return false;
  }

  // O formato esperado é AAAA-MM-DD, usado por input type="date".
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return false;
  }

  const [ano, mes, dia] = valor.split("-").map(Number);

  if (ano < 1000 || mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    return false;
  }

  const data = new Date(Date.UTC(ano, mes - 1, dia));

  return (
    data.getUTCFullYear() === ano &&
    data.getUTCMonth() === mes - 1 &&
    data.getUTCDate() === dia
  );
}

let produtosCarregados = [];

async function carregarProdutos() {
  productSelect.innerHTML =
    '<option value="">Carregando produtos...</option>';
  productSelect.disabled = true;

  try {
    const resposta = await fetch("/api/produtos");

    if (!resposta.ok) {
      throw new Error("Não foi possível consultar os produtos.");
    }

    const produtos = await resposta.json();

    if (!Array.isArray(produtos)) {
      throw new Error("A API retornou uma resposta inesperada.");
    }

    productSelect.replaceChildren();

    const primeiraOpcao = document.createElement("option");
    primeiraOpcao.value = "";
    primeiraOpcao.textContent = produtos.length
      ? "Selecione um produto"
      : "Nenhum produto ativo encontrado";

    productSelect.appendChild(primeiraOpcao);

    produtos.forEach((produto) => {
      const opcao = document.createElement("option");
      opcao.value = String(produto.id);
      opcao.textContent = produto.nome;
      productSelect.appendChild(opcao);
    });

    produtosCarregados = produtos;
    carregarPainel();
    desenharLista(produtos);

    if (!produtos.length) {
      mostrarMensagem(
        "error",
        "Não há produtos ativos para associar ao lote. Cadastre ou ative um produto antes de continuar."
      );
    }
  } catch (erro) {
    console.error("Erro ao carregar produtos:", erro);

    productSelect.replaceChildren();

    const opcao = document.createElement("option");
    opcao.value = "";
    opcao.textContent = "Erro ao carregar produtos";
    productSelect.appendChild(opcao);

    mostrarMensagem(
      "error",
      "Não foi possível carregar os produtos. Confirme se o Flask e o banco de dados estão funcionando e atualize a página."
    );
  } finally {
    productSelect.disabled = false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  limparMensagem();

  if (!form.reportValidity()) {
    return;
  }

  const dados = new FormData(form);

  const dataTorra = String(dados.get("data_torra") || "").trim();
  const dataValidade = String(dados.get("data_validade") || "").trim();
  const pontuacaoTexto = String(dados.get("pontuacao") ?? "").trim();
  const estoqueTexto = String(dados.get("estoque") ?? "").trim();
  const produtoId = Number(dados.get("produto_id"));

  if (!dataValida(dataTorra) || !dataValida(dataValidade)) {
    mostrarMensagem(
      "error",
      "Informe datas válidas para a torra e a validade. Utilize os campos de data do formulário."
    );
    return;
  }

  // Como as datas estão no formato AAAA-MM-DD,
  // a comparação dos textos funciona corretamente.
  if (dataValidade < dataTorra) {
    mostrarMensagem(
      "error",
      "A data de validade não pode ser anterior à data da torra."
    );
    return;
  }

  if (pontuacaoTexto === "") {
    mostrarMensagem("error", "Informe a pontuação do café.");
    return;
  }

  const pontuacao = Number(pontuacaoTexto);

  if (
    !Number.isFinite(pontuacao) ||
    pontuacao < 0 ||
    pontuacao > 100
  ) {
    mostrarMensagem(
      "error",
      "A pontuação deve estar entre 0 e 100."
    );
    return;
  }

  if (estoqueTexto === "") {
    mostrarMensagem("error", "Informe a quantidade em estoque.");
    return;
  }

  const estoque = Number(estoqueTexto);

  if (!Number.isInteger(estoque) || estoque < 0) {
    mostrarMensagem(
      "error",
      "O estoque deve ser um número inteiro igual ou maior que zero."
    );
    return;
  }

  if (!Number.isInteger(produtoId) || produtoId <= 0) {
    mostrarMensagem("error", "Selecione um produto válido.");
    return;
  }

  const payload = {
    produto_id: produtoId,
    codigo_lote: String(dados.get("codigo_lote") || "").trim(),
    produtor: String(dados.get("produtor") || "").trim(),
    fazenda: String(dados.get("fazenda") || "").trim(),
    origem: String(dados.get("origem") || "").trim(),
    processo: String(dados.get("processo") || "").trim(),
    data_torra: dataTorra,
    data_validade: dataValidade,
    pontuacao,
    estoque
  };

  const camposObrigatorios = [
    "codigo_lote",
    "produtor",
    "fazenda",
    "origem",
    "processo"
  ];

  if (camposObrigatorios.some((campo) => !payload[campo])) {
    mostrarMensagem(
      "error",
      "Preencha todos os campos obrigatórios antes de cadastrar."
    );
    return;
  }

  submitButton.disabled = true;
  submitLabel.textContent = "Enviando...";

  try {
    const resposta = await fetch("/api/origem-viva", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const resultado = await resposta.json().catch(() => ({}));

   
if (!resposta.ok) {
  throw new Error(
    resultado.erro ||
    resultado.error ||
    `O servidor respondeu com o status ${resposta.status}.`
  );
}


    mostrarMensagem(
      "success",
      resultado.mensagem ||
        "Lote cadastrado com sucesso!"
    );

    form.reset();

    await carregarProdutos();
  } catch (erro) {
    console.error("Erro ao cadastrar lote:", erro);

    mostrarMensagem(
      "error",
      erro.message ||
        "Não foi possível enviar o cadastro. Verifique o servidor Flask e tente novamente."
    );
  } finally {
    submitButton.disabled = false;
    submitLabel.textContent = "Cadastrar lote";
  }
});

carregarProdutos();


// ======================================================
// CADASTRO DE CAFÉS (PRODUTOS)
// ======================================================
const productForm = document.getElementById("productForm");
const productMessage = document.getElementById("productMessage");
const productSubmit = document.getElementById("productSubmit");
const productSubmitLabel = productSubmit.querySelector(".submit-label");

let idEmEdicao = null;
const productCancel = document.getElementById("productCancel");
const productFormTitle = document.getElementById("productFormTitle");
const productFormEyebrow = document.getElementById("productFormEyebrow");
const productFormHint = document.getElementById("productFormHint");
const TEXTO_HINT_CADASTRO = productFormHint.textContent;

function entrarNoModoEdicao(produto) {
  idEmEdicao = produto.id;
  productMessage.hidden = true;
  productForm.reset();

  const definir = (id, valor) => { document.getElementById(id).value = valor ?? ""; };
  definir("p_nome", produto.nome);
  definir("p_descricao", produto.descricao);
  definir("p_origem", produto.origem);
  definir("p_preco", Number(produto.preco).toFixed(2));
  definir("p_peso", produto.peso);
  definir("p_torra", produto.torra);
  definir("p_notas", produto.notas_sensoriais);
  definir("p_categoria", produto.categoria);
  definir("p_tag", produto.tag);
  definir("p_imagem", produto.imagem_url);

  const perfis = String(produto.perfil_sensorial || "").split(",").map((p) => p.trim().toLowerCase());
  productForm.querySelectorAll('input[name="perfil_sensorial"]').forEach((caixa) => {
    caixa.checked = perfis.includes(caixa.value);
  });

  productFormEyebrow.textContent = "EDITANDO";
  productFormTitle.textContent = `Editar café: ${produto.nome}`;
  productFormHint.textContent = "Altere os campos desejados e clique em Salvar alterações. Os lotes do café continuam associados a ele.";
  productSubmitLabel.textContent = "Salvar alterações";
  productCancel.hidden = false;

  document.getElementById("productFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("p_nome").focus({ preventScroll: true });
}

function sairDoModoEdicao() {
  idEmEdicao = null;
  productForm.reset();
  productFormEyebrow.textContent = "CATÁLOGO";
  productFormTitle.textContent = "Cadastrar café";
  productFormHint.textContent = TEXTO_HINT_CADASTRO;
  productSubmitLabel.textContent = "Cadastrar café";
  productCancel.hidden = true;
}

productCancel.addEventListener("click", () => {
  sairDoModoEdicao();
  productMessage.hidden = true;
});

function mostrarMensagemProduto(tipo, texto) {
  productMessage.className = `admin-message ${tipo}`;
  productMessage.textContent = texto;
  productMessage.hidden = false;
}

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  productMessage.hidden = true;

  if (!productForm.reportValidity()) {
    return;
  }

  const dados = new FormData(productForm);
  const perfis = dados.getAll("perfil_sensorial");

  if (!perfis.length) {
    mostrarMensagemProduto("error", "Selecione ao menos um perfil sensorial.");
    return;
  }

  const campo = (nome) => String(dados.get(nome) || "").trim();
  const payload = {
    nome: campo("nome"),
    descricao: campo("descricao"),
    origem: campo("origem"),
    preco: campo("preco"),
    peso: campo("peso"),
    torra: campo("torra"),
    perfil_sensorial: perfis,
    notas_sensoriais: campo("notas_sensoriais"),
    categoria: campo("categoria"),
    tag: campo("tag"),
    imagem_url: campo("imagem_url")
  };

  productSubmit.disabled = true;
  productSubmitLabel.textContent = "Enviando...";

  try {
    const editando = idEmEdicao !== null;
    const resposta = await fetch(editando ? `/api/produtos/${idEmEdicao}` : "/api/produtos", {
      method: editando ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const resultado = await resposta.json().catch(() => ({}));

    if (resposta.status === 401) {
      window.location.href = "/login?proxima=/admin";
      return;
    }
    if (!resposta.ok) {
      throw new Error(resultado.erro || `O servidor respondeu com o status ${resposta.status}.`);
    }

    mostrarMensagemProduto("success", resultado.mensagem || (editando ? "Café atualizado com sucesso!" : "Café cadastrado com sucesso!"));
    sairDoModoEdicao();
    await carregarProdutos(); // atualiza a lista de produtos do formulário de lotes
  } catch (erro) {
    console.error("Erro ao salvar café:", erro);
    mostrarMensagemProduto("error", erro.message || "Não foi possível salvar o café.");
  } finally {
    productSubmit.disabled = false;
    productSubmitLabel.textContent = idEmEdicao !== null ? "Salvar alterações" : "Cadastrar café";
  }
});


// ======================================================
// LISTA DE CAFÉS E EXCLUSÃO
// ======================================================
function desenharLista(produtos) {
  const productList = document.getElementById("productList");
  productList.replaceChildren();

  if (!produtos.length) {
    const vazio = document.createElement("li");
    vazio.textContent = "Nenhum café cadastrado.";
    productList.appendChild(vazio);
    return;
  }

  produtos.forEach((produto) => {
    const item = document.createElement("li");
    const nome = document.createElement("span");
    nome.textContent = produto.nome;
    if (produto.origem) {
      const origem = document.createElement("small");
      origem.textContent = produto.origem;
      nome.appendChild(origem);
    }

    const botaoEditar = document.createElement("button");
    botaoEditar.type = "button";
    botaoEditar.className = "admin-edit";
    botaoEditar.textContent = "Editar";
    botaoEditar.addEventListener("click", () => entrarNoModoEdicao(produto));

    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "admin-delete";
    botao.textContent = "Apagar";
    botao.addEventListener("click", () => apagarCafe(produto, botao));

    const acoes = document.createElement("div");
    acoes.className = "admin-actions";
    acoes.append(botaoEditar, botao);

    item.append(nome, acoes);
    productList.appendChild(item);
  });
}

async function apagarCafe(produto, botao) {
  const listMessage = document.getElementById("listMessage");
  const confirmado = window.confirm(
    `Apagar "${produto.nome}" e todos os lotes dele?\n\nEsta ação não pode ser desfeita.`
  );
  if (!confirmado) {
    return;
  }

  botao.disabled = true;
  listMessage.hidden = true;

  try {
    const resposta = await fetch(`/api/produtos/${produto.id}`, { method: "DELETE" });
    const resultado = await resposta.json().catch(() => ({}));

    if (resposta.status === 401) {
      window.location.href = "/login?proxima=/admin";
      return;
    }
    if (!resposta.ok) {
      throw new Error(resultado.erro || `O servidor respondeu com o status ${resposta.status}.`);
    }

    if (idEmEdicao === produto.id) {
      sairDoModoEdicao();
    }
    listMessage.className = "admin-message success";
    listMessage.textContent = resultado.mensagem || "Café apagado.";
    listMessage.hidden = false;
    await carregarProdutos();
  } catch (erro) {
    console.error("Erro ao apagar café:", erro);
    listMessage.className = "admin-message error";
    listMessage.textContent = erro.message || "Não foi possível apagar o café.";
    listMessage.hidden = false;
    botao.disabled = false;
  }
}


// ======================================================
// PAINEL: INDICADORES E LOTES EM ORDEM FEFO
// ======================================================
const escHtml = valor => String(valor ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dataBr = (iso) => {
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

async function carregarPainel() {
  const corpo = document.getElementById("lotsBody");
  const aviso = document.getElementById("lotsMessage");
  try {
    const [resumoResp, lotesResp] = await Promise.all([
      fetch("/api/admin/resumo"),
      fetch("/api/admin/lotes")
    ]);
    if (resumoResp.status === 401 || lotesResp.status === 401) {
      window.location.href = "/login?proxima=/admin";
      return;
    }
    if (!resumoResp.ok || !lotesResp.ok) {
      throw new Error("Falha ao consultar o painel.");
    }
    const resumo = await resumoResp.json();
    const lotes = await lotesResp.json();

    document.getElementById("kpiCafes").textContent = resumo.cafes_ativos;
    document.getElementById("kpiLotes").textContent = resumo.lotes;
    document.getElementById("kpiEstoque").textContent = resumo.estoque_total;
    document.getElementById("kpiVence").textContent = resumo.vence_em_breve;
    document.getElementById("kpiVenceLabel").textContent = `Vencem em ${resumo.limite_vencimento_dias} dias`;
    document.getElementById("kpiBaixo").textContent = resumo.estoque_baixo;
    document.getElementById("kpiVencidos").textContent = resumo.vencidos;
    document.querySelectorAll(".kpi-warn, .kpi-bad").forEach((el) => {
      el.classList.toggle("kpi-active", Number(el.querySelector("strong").textContent) > 0);
    });

    aviso.hidden = true;
    if (!lotes.length) {
      corpo.innerHTML = '<tr><td colspan="7" class="table-empty">Nenhum lote cadastrado ainda. Use o formulário “Informações do lote”.</td></tr>';
      return;
    }
    const classes = { ok: "badge-ok", estoque_baixo: "badge-warn", vence_em_breve: "badge-warn", esgotado: "badge-muted", vencido: "badge-bad" };
    corpo.innerHTML = lotes.map((l) => {
      const codigo = encodeURIComponent(l.codigo_lote);
      return `<tr>
        <td><strong>${escHtml(l.codigo_lote)}</strong></td>
        <td>${escHtml(l.cafe)}</td>
        <td>${dataBr(l.data_torra)}</td>
        <td>${dataBr(l.data_validade)}</td>
        <td class="num">${l.estoque}</td>
        <td><span class="badge ${classes[l.situacao] || "badge-muted"}">${escHtml(l.situacao_rotulo)}</span></td>
        <td class="table-actions">
          <a href="/lote/${codigo}" target="_blank" rel="noopener">Página</a>
          <a href="/api/lotes/${codigo}/qrcode.png?baixar=1">Baixar QR</a>
        </td>
      </tr>`;
    }).join("");
  } catch (erro) {
    console.error("Erro ao carregar o painel:", erro);
    corpo.innerHTML = '<tr><td colspan="7" class="table-empty">Não foi possível carregar os lotes.</td></tr>';
  }
}
