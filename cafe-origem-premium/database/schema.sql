-- Café Origem Premium — estrutura do banco (MySQL 8+)
-- Reconstruída a partir das consultas do app.py. Se o seu banco já existe,
-- compare com ele antes de usar este script.

CREATE DATABASE IF NOT EXISTS cafe_origem CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cafe_origem;

CREATE TABLE IF NOT EXISTS produtos (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    nome             VARCHAR(150)  NOT NULL,
    descricao        TEXT          NOT NULL,
    categoria        VARCHAR(80)   NOT NULL DEFAULT 'Cafe especial',
    preco            DECIMAL(10,2) NOT NULL,
    imagem_url       VARCHAR(500)  NULL,
    origem           VARCHAR(180)  NOT NULL,
    peso             VARCHAR(40)   NOT NULL DEFAULT '250 g',
    torra            VARCHAR(20)   NOT NULL,            -- clara | media | escura
    notas_sensoriais VARCHAR(255)  NOT NULL,            -- separadas por ponto e vírgula
    perfil_sensorial VARCHAR(100)  NOT NULL,            -- chocolate,frutado,floral
    tag              VARCHAR(60)   NOT NULL DEFAULT 'Cafe especial',
    ativo            BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS lotes_cafe (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    produto_id    INT           NOT NULL,
    codigo_lote   VARCHAR(80)   NOT NULL UNIQUE,        -- vira o endereço do QR Code (/lote/<codigo>)
    produtor      VARCHAR(150)  NOT NULL,
    fazenda       VARCHAR(150)  NOT NULL,
    origem        VARCHAR(180)  NOT NULL,
    processo      VARCHAR(80)   NOT NULL,
    data_torra    DATE          NOT NULL,
    data_validade DATE          NOT NULL,
    pontuacao     DECIMAL(4,1)  NOT NULL,               -- 0 a 100
    estoque       INT           NOT NULL DEFAULT 0,
    CONSTRAINT fk_lote_produto FOREIGN KEY (produto_id) REFERENCES produtos(id),
    INDEX idx_lote_validade (data_validade)
);
