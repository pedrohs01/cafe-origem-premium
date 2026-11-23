import io
import os
import re
from contextlib import contextmanager
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps

import mysql.connector
from dotenv import load_dotenv
from flask import (Flask, jsonify, request, send_from_directory, send_file, redirect,
                   url_for, render_template, session, flash)

load_dotenv()
app = Flask(__name__, static_folder=None)

secret_key = os.getenv("FLASK_SECRET_KEY")
if not secret_key:
    raise RuntimeError("Configure FLASK_SECRET_KEY no arquivo .env antes de iniciar.")

app.config.update(
    SECRET_KEY=secret_key,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=2),
)

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")


def login_obrigatorio(funcao):
    @wraps(funcao)
    def wrapper(*args, **kwargs):
        if session.get("administrador_logado") is not True:
            if request.path.startswith("/api/"):
                return jsonify({"erro": "Acesso nao autorizado. Faca login."}), 401
            return redirect(url_for("login", proxima=request.path))
        return funcao(*args, **kwargs)
    return wrapper


@app.route("/login", methods=["GET", "POST"])
def login():
    if session.get("administrador_logado") is True:
        return redirect(url_for("admin"))
    if request.method == "POST":
        usuario = request.form.get("usuario", "").strip()
        senha = request.form.get("senha", "")
        if not ADMIN_USERNAME or not ADMIN_PASSWORD:
            flash("O acesso administrativo ainda nao foi configurado no servidor.", "erro")
            return render_template("login.html"), 503
        if usuario == ADMIN_USERNAME and senha == ADMIN_PASSWORD:
            session.clear()
            session["administrador_logado"] = True
            session["usuario_admin"] = usuario
            session.permanent = True
            proxima = request.args.get("proxima", "")
            if not proxima.startswith("/") or proxima.startswith("//"):
                proxima = url_for("admin")
            return redirect(proxima)
        flash("Usuario ou senha incorretos.", "erro")
    return render_template("login.html")


@app.route("/logout", methods=["POST"])
@login_obrigatorio
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/admin")
@login_obrigatorio
def admin():
    return send_from_directory(".", "admin.html")


@app.route("/arquivos/<path:nome_arquivo>")
def arquivos_publicos(nome_arquivo):
    nome_normalizado = nome_arquivo.replace("\\\\", "/").lstrip("/")
    partes = nome_normalizado.split("/")
    nome_final = partes[-1].lower()
    if (nome_final in {"admin.html", "app.py", ".env"}
        or nome_final.endswith((".py", ".pyc"))
        or any(p.startswith(".") or p in {".venv", "__pycache__", "venv"} for p in partes)):
        if nome_final == "admin.html":
            return redirect(url_for("admin"))
        return "Arquivo nao encontrado.", 404
    return send_from_directory(".", nome_normalizado)


def conectar_banco():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME", "cafe_origem"),
    )


@app.route("/")
def inicio():
    return send_from_directory(".", "index.html")


@contextmanager
def banco():
    """Abre conexao + cursor (dicionario) e fecha tudo no final. Usado nas rotas de consulta."""
    conexao = conectar_banco()
    cursor = conexao.cursor(dictionary=True)
    try:
        yield cursor
    finally:
        cursor.close()
        if conexao.is_connected():
            conexao.close()


# ---------------------------------------------------------------------------
# Lotes: frescor, validade e FEFO (First Expired, First Out)
# ---------------------------------------------------------------------------
LIMITE_VENCIMENTO_DIAS = 30   # alerta de "vence em breve"
LIMITE_ESTOQUE_BAIXO = 10     # alerta de "poucas unidades"


def _como_data(valor):
    if valor is None:
        return None
    if isinstance(valor, date):
        return valor
    return date.fromisoformat(str(valor)[:10])


def _numero(valor):
    if valor is None:
        return None
    numero = float(valor)
    return int(numero) if numero.is_integer() else numero


def situacao_lote(lote, hoje=None):
    """Classifica o lote para os alertas do painel e para a vitrine."""
    hoje = hoje or date.today()
    validade = _como_data(lote["data_validade"])
    estoque = int(lote["estoque"] or 0)
    dias = (validade - hoje).days
    if dias < 0:
        return "vencido", "Vencido"
    if estoque == 0:
        return "esgotado", "Esgotado"
    if dias <= LIMITE_VENCIMENTO_DIAS:
        return "vence_em_breve", f"Vence em {dias} dia{'s' if dias != 1 else ''}"
    if estoque <= LIMITE_ESTOQUE_BAIXO:
        return "estoque_baixo", "Estoque baixo"
    return "ok", "Em dia"


def lote_para_json(lote, incluir_estoque=False, hoje=None):
    """Converte uma linha de lotes_cafe em dicionario pronto para JSON."""
    hoje = hoje or date.today()
    torra = _como_data(lote["data_torra"])
    validade = _como_data(lote["data_validade"])
    estoque = int(lote["estoque"] or 0)
    codigo_situacao, rotulo_situacao = situacao_lote(lote, hoje)
    if estoque == 0:
        disponibilidade = "esgotado"
    elif estoque <= LIMITE_ESTOQUE_BAIXO:
        disponibilidade = "poucas_unidades"
    else:
        disponibilidade = "disponivel"
    dados = {
        "codigo_lote": lote["codigo_lote"],
        "produtor": lote.get("produtor"),
        "fazenda": lote.get("fazenda"),
        "origem": lote.get("origem"),
        "processo": lote.get("processo"),
        "data_torra": torra.isoformat(),
        "data_validade": validade.isoformat(),
        "dias_desde_torra": (hoje - torra).days,
        "dias_para_vencer": (validade - hoje).days,
        "pontuacao": _numero(lote.get("pontuacao")),
        "disponibilidade": disponibilidade,
        "situacao": codigo_situacao,
        "situacao_rotulo": rotulo_situacao,
    }
    if incluir_estoque:
        dados["estoque"] = estoque
    return dados


def escolher_lote_fefo(lotes, hoje=None):
    """FEFO: entre os lotes com estoque e dentro da validade, vende primeiro o que vence antes.
    Em empate de validade, prefere o torrado mais recentemente."""
    hoje = hoje or date.today()
    candidatos = [l for l in lotes
                  if int(l["estoque"] or 0) > 0 and _como_data(l["data_validade"]) >= hoje]
    if not candidatos:
        return None
    return sorted(candidatos,
                  key=lambda l: (_como_data(l["data_validade"]), -_como_data(l["data_torra"]).toordinal()))[0]


def url_publica_lote(codigo):
    """Endereco que o QR Code do lote abre. Defina BASE_URL no .env para o QR funcionar no celular."""
    base = (os.getenv("BASE_URL") or request.host_url).rstrip("/")
    return f"{base}/lote/{codigo}"


@app.route("/api/produtos", methods=["GET"])
def listar_produtos():
    try:
        hoje = date.today()
        with banco() as cursor:
            cursor.execute("""
                SELECT id, nome, descricao, categoria, preco, imagem_url, origem,
                       peso, torra, notas_sensoriais, perfil_sensorial, tag
                FROM produtos WHERE ativo = TRUE ORDER BY nome
            """)
            produtos = cursor.fetchall()
            cursor.execute("""
                SELECT produto_id, codigo_lote, produtor, fazenda, origem, processo,
                       data_torra, data_validade, pontuacao, estoque
                FROM lotes_cafe
            """)
            lotes_por_produto = {}
            for lote in cursor.fetchall():
                lotes_por_produto.setdefault(lote["produto_id"], []).append(lote)

        for produto in produtos:
            lotes = lotes_por_produto.get(produto["id"], [])
            validos = [l for l in lotes if _como_data(l["data_validade"]) >= hoje]
            fefo = escolher_lote_fefo(lotes, hoje)
            # Sem nenhum lote cadastrado o estoque e "desconhecido" (None); a vitrine continua vendendo.
            produto["estoque_total"] = sum(int(l["estoque"] or 0) for l in validos) if lotes else None
            produto["lote"] = lote_para_json(fefo, hoje=hoje) if fefo else None
        return jsonify(produtos)
    except mysql.connector.Error:
        app.logger.exception("Erro ao consultar produtos")
        return jsonify({"erro": "Nao foi possivel consultar os produtos."}), 500


def validar_produto(dados):
    """Valida o JSON de um cafe (usado ao cadastrar e ao editar).
    Retorna um dicionario limpo ou levanta ValueError com a mensagem para o usuario."""
    if not isinstance(dados, dict):
        raise ValueError("Envie os dados do cafe em formato JSON.")

    def texto(campo, obrigatorio, maximo):
        valor = dados.get(campo)
        if valor is None or (isinstance(valor, str) and not valor.strip()):
            if obrigatorio:
                raise ValueError(f"O campo '{campo}' e obrigatorio.")
            return None
        if not isinstance(valor, str):
            raise ValueError(f"O campo '{campo}' deve ser um texto.")
        valor = valor.strip()
        if len(valor) > maximo:
            raise ValueError(f"O campo '{campo}' aceita no maximo {maximo} caracteres.")
        return valor

    nome = texto("nome", True, 150)
    descricao = texto("descricao", True, 2000)
    origem = texto("origem", True, 180)
    categoria = texto("categoria", False, 80) or "Cafe especial"
    peso = texto("peso", False, 40) or "250 g"
    tag = texto("tag", False, 60) or "Cafe especial"
    notas = texto("notas_sensoriais", True, 255)
    imagem_url = texto("imagem_url", False, 500)

    torra = (texto("torra", True, 20) or "").lower()
    if torra not in {"clara", "media", "escura"}:
        raise ValueError("A torra deve ser clara, media ou escura.")

    perfis = dados.get("perfil_sensorial")
    if isinstance(perfis, str):
        perfis = [p for p in perfis.split(",")]
    if not isinstance(perfis, list):
        raise ValueError("Selecione ao menos um perfil sensorial.")
    perfis = [str(p).strip().lower() for p in perfis if str(p).strip()]
    if not perfis or any(p not in {"chocolate", "frutado", "floral"} for p in perfis):
        raise ValueError("Perfil sensorial invalido. Use chocolate, frutado ou floral.")
    perfil_sensorial = ",".join(dict.fromkeys(perfis))

    if imagem_url and not (imagem_url.startswith(("https://", "http://"))
                           or (imagem_url.startswith("/arquivos/") and ".." not in imagem_url)):
        raise ValueError("A imagem deve ser um link http(s) ou um caminho /arquivos/...")

    try:
        preco = Decimal(str(dados.get("preco")).replace(",", "."))
        if not preco.is_finite() or preco <= 0 or preco > Decimal("99999.99"):
            raise ValueError
        preco = preco.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise ValueError("O preco deve ser um numero maior que zero.")

    return {"nome": nome, "descricao": descricao, "categoria": categoria, "preco": preco,
            "imagem_url": imagem_url, "origem": origem, "peso": peso, "torra": torra,
            "notas_sensoriais": notas, "perfil_sensorial": perfil_sensorial, "tag": tag}


@app.route("/api/produtos", methods=["POST"])
@login_obrigatorio
def cadastrar_produto():
    conexao = cursor = None
    try:
        p = validar_produto(request.get_json(silent=True))
    except ValueError as erro:
        return jsonify({"erro": str(erro)}), 400

    try:
        conexao = conectar_banco()
        cursor = conexao.cursor(dictionary=True)
        cursor.execute("SELECT id FROM produtos WHERE LOWER(nome) = LOWER(%s)", (p["nome"],))
        if cursor.fetchone() is not None:
            return jsonify({"erro": "Ja existe um cafe cadastrado com esse nome."}), 409
        cursor.execute("""
            INSERT INTO produtos (
                nome, descricao, categoria, preco, imagem_url, origem, peso,
                torra, notas_sensoriais, perfil_sensorial, tag, ativo
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
        """, (p["nome"], p["descricao"], p["categoria"], p["preco"], p["imagem_url"],
              p["origem"], p["peso"], p["torra"], p["notas_sensoriais"],
              p["perfil_sensorial"], p["tag"]))
        conexao.commit()
        return jsonify({"mensagem": "Cafe cadastrado com sucesso.",
                        "id": cursor.lastrowid, "nome": p["nome"]}), 201
    except mysql.connector.Error:
        if conexao is not None and conexao.is_connected():
            conexao.rollback()
        app.logger.exception("Erro ao cadastrar produto")
        return jsonify({"erro": "Ocorreu um erro ao salvar o cafe no banco de dados."}), 500
    finally:
        if cursor is not None:
            cursor.close()
        if conexao is not None and conexao.is_connected():
            conexao.close()


@app.route("/api/produtos/<int:produto_id>", methods=["PUT"])
@login_obrigatorio
def editar_produto(produto_id):
    conexao = cursor = None
    try:
        p = validar_produto(request.get_json(silent=True))
    except ValueError as erro:
        return jsonify({"erro": str(erro)}), 400

    try:
        conexao = conectar_banco()
        cursor = conexao.cursor(dictionary=True)
        cursor.execute("SELECT id FROM produtos WHERE id = %s", (produto_id,))
        if cursor.fetchone() is None:
            return jsonify({"erro": "Cafe nao encontrado."}), 404
        # O nome nao pode repetir o de OUTRO cafe (o proprio cafe pode manter o nome).
        cursor.execute("SELECT id FROM produtos WHERE LOWER(nome) = LOWER(%s) AND id <> %s",
                       (p["nome"], produto_id))
        if cursor.fetchone() is not None:
            return jsonify({"erro": "Ja existe outro cafe cadastrado com esse nome."}), 409
        cursor.execute("""
            UPDATE produtos SET
                nome = %s, descricao = %s, categoria = %s, preco = %s, imagem_url = %s,
                origem = %s, peso = %s, torra = %s, notas_sensoriais = %s,
                perfil_sensorial = %s, tag = %s
            WHERE id = %s
        """, (p["nome"], p["descricao"], p["categoria"], p["preco"], p["imagem_url"],
              p["origem"], p["peso"], p["torra"], p["notas_sensoriais"],
              p["perfil_sensorial"], p["tag"], produto_id))
        conexao.commit()
        return jsonify({"mensagem": "Cafe atualizado com sucesso.",
                        "id": produto_id, "nome": p["nome"]})
    except mysql.connector.Error:
        if conexao is not None and conexao.is_connected():
            conexao.rollback()
        app.logger.exception("Erro ao editar produto")
        return jsonify({"erro": "Ocorreu um erro ao atualizar o cafe no banco de dados."}), 500
    finally:
        if cursor is not None:
            cursor.close()
        if conexao is not None and conexao.is_connected():
            conexao.close()


@app.route("/api/produtos/<int:produto_id>", methods=["DELETE"])
@login_obrigatorio
def apagar_produto(produto_id):
    conexao = cursor = None
    try:
        conexao = conectar_banco()
        cursor = conexao.cursor(dictionary=True)
        cursor.execute("SELECT id, nome FROM produtos WHERE id = %s", (produto_id,))
        produto = cursor.fetchone()
        if produto is None:
            return jsonify({"erro": "Cafe nao encontrado."}), 404
        # Os lotes dependem do produto, entao saem junto (tudo na mesma transacao).
        cursor.execute("DELETE FROM lotes_cafe WHERE produto_id = %s", (produto_id,))
        lotes_apagados = cursor.rowcount
        cursor.execute("DELETE FROM produtos WHERE id = %s", (produto_id,))
        conexao.commit()
        return jsonify({"mensagem": f"Cafe '{produto['nome']}' apagado.",
                        "lotes_apagados": lotes_apagados})
    except mysql.connector.Error:
        if conexao is not None and conexao.is_connected():
            conexao.rollback()
        app.logger.exception("Erro ao apagar produto")
        return jsonify({"erro": "Nao foi possivel apagar o cafe. Ele pode estar ligado a outros registros (ex.: pedidos)."}), 409
    finally:
        if cursor is not None:
            cursor.close()
        if conexao is not None and conexao.is_connected():
            conexao.close()


@app.route("/api/origem-viva", methods=["GET"])
def listar_origem_viva():
    conexao = cursor = None
    try:
        conexao = conectar_banco()
        cursor = conexao.cursor(dictionary=True)
        cursor.execute("""
            SELECT p.id AS produto_id, p.nome AS cafe, p.descricao, p.preco,
                   p.imagem_url, l.codigo_lote, l.produtor, l.fazenda, l.origem,
                   l.processo, l.data_torra, l.data_validade, l.pontuacao, l.estoque
            FROM lotes_cafe l INNER JOIN produtos p ON p.id = l.produto_id
            WHERE p.ativo = TRUE ORDER BY l.data_torra DESC
        """)
        lotes = cursor.fetchall()
        for lote in lotes:
            for campo in ("data_torra", "data_validade"):
                if lote[campo] is not None:
                    lote[campo] = lote[campo].isoformat()
        return jsonify(lotes)
    except mysql.connector.Error:
        app.logger.exception("Erro ao consultar Origem Viva")
        return jsonify({"erro": "Nao foi possivel consultar os lotes."}), 500
    finally:
        if cursor is not None:
            cursor.close()
        if conexao is not None and conexao.is_connected():
            conexao.close()


@app.route("/api/origem-viva", methods=["POST"])
@login_obrigatorio
def cadastrar_lote():
    conexao = cursor = None
    dados = request.get_json(silent=True)
    if not isinstance(dados, dict):
        return jsonify({"erro": "Envie os dados do lote em formato JSON."}), 400

    campos_texto = ["codigo_lote", "produtor", "fazenda", "origem", "processo"]
    valores = {}
    for campo in campos_texto:
        valor = dados.get(campo)
        if not isinstance(valor, str) or not valor.strip():
            return jsonify({"erro": f"O campo '{campo}' e obrigatorio."}), 400
        valores[campo] = valor.strip()

    # O codigo vira parte do endereco do QR Code (/lote/<codigo>), entao so aceita caracteres seguros.
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", valores["codigo_lote"]):
        return jsonify({"erro": "O codigo do lote deve ter ate 80 caracteres, usando apenas letras, numeros, ponto, hifen ou sublinhado (sem espacos)."}), 400

    try:
        produto_id = int(dados.get("produto_id"))
        if produto_id <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"erro": "Selecione um produto valido."}), 400

    datas = {}
    for campo in ("data_torra", "data_validade"):
        valor = dados.get(campo)
        if not isinstance(valor, str) or not valor.strip():
            return jsonify({"erro": f"O campo '{campo}' e obrigatorio."}), 400
        try:
            datas[campo] = date.fromisoformat(valor)
        except ValueError:
            return jsonify({"erro": f"A data informada em '{campo}' e invalida. Use AAAA-MM-DD."}), 400
    if datas["data_validade"] < datas["data_torra"]:
        return jsonify({"erro": "A validade nao pode ser anterior a data da torra."}), 400

    try:
        pontuacao = Decimal(str(dados.get("pontuacao")))
        if not pontuacao.is_finite() or not Decimal("0") <= pontuacao <= Decimal("100"):
            raise ValueError
    except (InvalidOperation, TypeError, ValueError):
        return jsonify({"erro": "A pontuacao deve ser um numero entre 0 e 100."}), 400

    estoque_recebido = dados.get("estoque")
    if isinstance(estoque_recebido, bool):
        return jsonify({"erro": "O estoque deve ser um numero inteiro maior ou igual a zero."}), 400
    try:
        estoque = int(estoque_recebido)
        if str(estoque) != str(estoque_recebido).strip() or estoque < 0:
            raise ValueError
    except (TypeError, ValueError, AttributeError):
        return jsonify({"erro": "O estoque deve ser um numero inteiro maior ou igual a zero."}), 400

    try:
        conexao = conectar_banco()
        cursor = conexao.cursor(dictionary=True)
        cursor.execute("SELECT id FROM produtos WHERE id = %s AND ativo = TRUE", (produto_id,))
        if cursor.fetchone() is None:
            return jsonify({"erro": "O produto selecionado nao existe ou esta inativo."}), 400
        cursor.execute("SELECT codigo_lote FROM lotes_cafe WHERE codigo_lote = %s", (valores["codigo_lote"],))
        if cursor.fetchone() is not None:
            return jsonify({"erro": "Ja existe um lote cadastrado com esse codigo."}), 409
        cursor.execute("""
            INSERT INTO lotes_cafe (
                produto_id, codigo_lote, produtor, fazenda, origem, processo,
                data_torra, data_validade, pontuacao, estoque
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            produto_id, valores["codigo_lote"], valores["produtor"], valores["fazenda"],
            valores["origem"], valores["processo"], datas["data_torra"],
            datas["data_validade"], pontuacao, estoque
        ))
        conexao.commit()
        return jsonify({"mensagem": "Lote cadastrado com sucesso.",
                        "codigo_lote": valores["codigo_lote"]}), 201
    except mysql.connector.IntegrityError:
        if conexao is not None and conexao.is_connected():
            conexao.rollback()
        app.logger.exception("Erro de integridade ao cadastrar lote")
        return jsonify({"erro": "Nao foi possivel cadastrar o lote. Verifique se o codigo ja existe e se os dados estao corretos."}), 409
    except mysql.connector.Error:
        if conexao is not None and conexao.is_connected():
            conexao.rollback()
        app.logger.exception("Erro ao cadastrar lote")
        return jsonify({"erro": "Ocorreu um erro ao salvar o lote no banco de dados."}), 500
    finally:
        if cursor is not None:
            cursor.close()
        if conexao is not None and conexao.is_connected():
            conexao.close()


# ---------------------------------------------------------------------------
# Origem Viva: pagina publica do lote (aberta pelo QR Code) e QR Code em PNG
# ---------------------------------------------------------------------------
def buscar_lote_publico(codigo):
    """Retorna (lote, produto) de um lote cujo cafe esta ativo, ou (None, None)."""
    with banco() as cursor:
        cursor.execute("""
            SELECT l.codigo_lote, l.produtor, l.fazenda, l.origem, l.processo,
                   l.data_torra, l.data_validade, l.pontuacao, l.estoque,
                   p.id AS produto_id, p.nome, p.descricao, p.preco, p.imagem_url,
                   p.peso, p.torra, p.notas_sensoriais, p.perfil_sensorial
            FROM lotes_cafe l INNER JOIN produtos p ON p.id = l.produto_id
            WHERE l.codigo_lote = %s AND p.ativo = TRUE
        """, (codigo,))
        linha = cursor.fetchone()
    if linha is None:
        return None, None
    produto = {
        "id": linha["produto_id"], "nome": linha["nome"], "descricao": linha["descricao"],
        "preco": _numero(linha["preco"]), "imagem_url": linha["imagem_url"], "peso": linha["peso"],
        "torra": linha["torra"], "notas_sensoriais": linha["notas_sensoriais"],
        "perfil_sensorial": linha["perfil_sensorial"],
    }
    return linha, produto


@app.route("/lote/<codigo>")
def pagina_lote(codigo):
    return send_from_directory(".", "lote.html")


@app.route("/api/lotes/<codigo>", methods=["GET"])
def detalhar_lote(codigo):
    try:
        lote, produto = buscar_lote_publico(codigo)
    except mysql.connector.Error:
        app.logger.exception("Erro ao consultar lote")
        return jsonify({"erro": "Nao foi possivel consultar o lote."}), 500
    if lote is None:
        return jsonify({"erro": "Lote nao encontrado."}), 404
    dados = lote_para_json(lote)          # estoque exato nao e publico: so a disponibilidade
    dados["produto"] = produto
    dados["url_publica"] = url_publica_lote(lote["codigo_lote"])
    return jsonify(dados)


@app.route("/api/lotes/<codigo>/qrcode.png", methods=["GET"])
def qrcode_do_lote(codigo):
    try:
        lote, _ = buscar_lote_publico(codigo)
    except mysql.connector.Error:
        app.logger.exception("Erro ao consultar lote para o QR Code")
        return jsonify({"erro": "Nao foi possivel consultar o lote."}), 500
    if lote is None:
        return jsonify({"erro": "Lote nao encontrado."}), 404
    try:
        import qrcode
    except ImportError:
        return jsonify({"erro": "Biblioteca qrcode nao instalada. Rode: pip install -r requirements.txt"}), 503

    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M,
                       box_size=10, border=3)
    qr.add_data(url_publica_lote(lote["codigo_lote"]))
    qr.make(fit=True)
    imagem = qr.make_image(fill_color="#3a2a1f", back_color="white")
    buffer = io.BytesIO()
    imagem.save(buffer, format="PNG")
    buffer.seek(0)
    baixar = request.args.get("baixar") == "1"
    resposta = send_file(buffer, mimetype="image/png", as_attachment=baixar,
                         download_name=f"qrcode-{lote['codigo_lote']}.png")
    resposta.headers["Cache-Control"] = "public, max-age=300"
    return resposta


# ---------------------------------------------------------------------------
# Painel administrativo: indicadores e lista de lotes em ordem FEFO
# ---------------------------------------------------------------------------
def _lotes_do_painel():
    with banco() as cursor:
        cursor.execute("""
            SELECT l.codigo_lote, l.produtor, l.fazenda, l.origem, l.processo,
                   l.data_torra, l.data_validade, l.pontuacao, l.estoque,
                   p.id AS produto_id, p.nome AS cafe
            FROM lotes_cafe l INNER JOIN produtos p ON p.id = l.produto_id
            ORDER BY l.data_validade ASC, l.data_torra DESC
        """)
        linhas = cursor.fetchall()
        cursor.execute("SELECT COUNT(*) AS total FROM produtos WHERE ativo = TRUE")
        cafes_ativos = int(cursor.fetchone()["total"])
    return linhas, cafes_ativos


@app.route("/api/admin/resumo", methods=["GET"])
@login_obrigatorio
def resumo_admin():
    try:
        linhas, cafes_ativos = _lotes_do_painel()
    except mysql.connector.Error:
        app.logger.exception("Erro ao montar o resumo do painel")
        return jsonify({"erro": "Nao foi possivel carregar o resumo."}), 500
    situacoes = [situacao_lote(l)[0] for l in linhas]
    return jsonify({
        "cafes_ativos": cafes_ativos,
        "lotes": len(linhas),
        "estoque_total": sum(int(l["estoque"] or 0) for l, s in zip(linhas, situacoes) if s != "vencido"),
        "vence_em_breve": situacoes.count("vence_em_breve"),
        "vencidos": situacoes.count("vencido"),
        "estoque_baixo": situacoes.count("estoque_baixo") + situacoes.count("esgotado"),
        "limite_vencimento_dias": LIMITE_VENCIMENTO_DIAS,
        "limite_estoque_baixo": LIMITE_ESTOQUE_BAIXO,
    })


@app.route("/api/admin/lotes", methods=["GET"])
@login_obrigatorio
def listar_lotes_admin():
    try:
        linhas, _ = _lotes_do_painel()
    except mysql.connector.Error:
        app.logger.exception("Erro ao listar lotes do painel")
        return jsonify({"erro": "Nao foi possivel listar os lotes."}), 500
    saida = []
    for linha in linhas:
        dados = lote_para_json(linha, incluir_estoque=True)
        dados["cafe"] = linha["cafe"]
        dados["produto_id"] = linha["produto_id"]
        dados["url_publica"] = url_publica_lote(linha["codigo_lote"])
        saida.append(dados)
    return jsonify(saida)


if __name__ == "__main__":
    app.run(debug=True)