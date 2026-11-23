# ☕ Café Origem Premium

Plataforma web para cafeteria de **cafés especiais** com **rastreabilidade por QR Code**: cada pacote leva o cliente à página pública do lote, com produtor, fazenda, processo, datas de torra e validade e pontuação do café.

> Projeto acadêmico **PIM III** — Sistemas de Informação.

## Diferenciais

- **Origem Viva com QR Code real** — página pública por lote (`/lote/<codigo>`) e QR Code em PNG gerado pelo servidor.
- **Frescor à vista** — a vitrine mostra "torrado há N dias", pontuação e validade do lote.
- **Estoque por lote com FEFO** (*First Expired, First Out*) — a vitrine usa o lote que vence primeiro e o painel alerta vencimentos e estoque baixo.
- **Recomendação explicável** — o quiz "Meu perfil de café" indica cafés e mostra o motivo de cada sugestão.
- **Painel administrativo** — indicadores, lotes por ordem de vencimento, cadastro/edição/exclusão de cafés e cadastro de lotes.

<!-- Adicione aqui prints da vitrine, da página do lote e do painel: ![Vitrine](docs/vitrine.png) -->

## Tecnologias

HTML, CSS e JavaScript (sem frameworks) · Python 3 · Flask · MySQL · `mysql-connector-python` · `qrcode` + Pillow · `python-dotenv`

## Estrutura

```
cafe-origem-premium/
├── app.py               # servidor Flask e API
├── index.html           # vitrine
├── lote.html            # página pública do lote (aberta pelo QR Code)
├── admin.html           # painel administrativo
├── templates/login.html # login do administrador
├── css/  js/  img/      # estilos, scripts e imagens
├── database/schema.sql  # criação das tabelas
├── uploads/             # imagens locais (não versionadas)
├── .env.example         # modelo de configuração
└── requirements.txt
```

## Como executar

1. **Clone e entre na pasta**
   ```bash
   git clone https://github.com/SEU-USUARIO/cafe-origem-premium.git
   cd cafe-origem-premium
   ```
2. **Ambiente virtual e dependências** (Windows)
   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. **Banco de dados** — com o MySQL rodando, execute `database/schema.sql` (MySQL Workbench ou `mysql -u root -p < database/schema.sql`).
4. **Configuração** — copie `.env.example` para `.env` e preencha os valores (senha do banco, chave secreta, usuário e senha do admin).
5. **Iniciar**
   ```bash
   python app.py
   ```
   Acesse `http://127.0.0.1:5000` (vitrine) e `http://127.0.0.1:5000/admin` (painel).

> Para o QR Code abrir no celular, defina `BASE_URL` no `.env` com o IP do seu computador na rede (ex.: `http://192.168.0.15:5000`).

## Rotas principais

| Acesso | Rota |
|---|---|
| Público | `GET /api/produtos` · `GET /api/origem-viva` · `GET /api/lotes/<codigo>` · `GET /api/lotes/<codigo>/qrcode.png` · `GET /lote/<codigo>` |
| Administrador (login) | `POST/PUT/DELETE /api/produtos` · `POST /api/origem-viva` · `GET /api/admin/resumo` · `GET /api/admin/lotes` |

## Limitações e próximos passos

- Checkout é demonstrativo (ainda não há pedidos nem pagamento).
- Edição e exclusão de lotes pelo painel.
- Pedidos reais com baixa automática de estoque pelo lote FEFO.
- Migrar para Flask-Login/Flask-WTF e testes automatizados (pytest).

`app.run(debug=True)` é apenas para desenvolvimento; não use em produção.

## Licença

[MIT](LICENSE)
