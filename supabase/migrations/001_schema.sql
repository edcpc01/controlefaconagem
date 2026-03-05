-- ============================================================
-- FAÇONAGEM RHODIA - SCHEMA SUPABASE
-- ============================================================

-- Tabela de NFs de Entrada
CREATE TABLE IF NOT EXISTS nf_entrada (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  numero_nf TEXT NOT NULL UNIQUE,
  data_emissao DATE NOT NULL,
  codigo_material TEXT NOT NULL,
  lote TEXT NOT NULL,
  volume_kg NUMERIC(12, 4) NOT NULL,
  volume_saldo_kg NUMERIC(12, 4) NOT NULL,
  valor_unitario NUMERIC(12, 6) NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de Saídas
CREATE TABLE IF NOT EXISTS saida (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  romaneio_microdata TEXT NOT NULL,
  codigo_produto TEXT NOT NULL,
  lote_produto TEXT NOT NULL,
  tipo_saida TEXT NOT NULL CHECK (tipo_saida IN ('faturamento', 'dev_qualidade', 'dev_processo', 'dev_final_campanha', 'sucata', 'estopa')),
  volume_bruto_kg NUMERIC(12, 4) NOT NULL,
  volume_abatido_kg NUMERIC(12, 4) NOT NULL,
  percentual_abatimento NUMERIC(5, 4) DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de Alocações (relaciona saída com NFs de entrada - FIFO)
CREATE TABLE IF NOT EXISTS alocacao_saida (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  saida_id UUID NOT NULL REFERENCES saida(id) ON DELETE CASCADE,
  nf_entrada_id UUID NOT NULL REFERENCES nf_entrada(id),
  numero_nf TEXT NOT NULL,
  data_emissao DATE NOT NULL,
  volume_alocado_kg NUMERIC(12, 4) NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger para atualizar timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nf_entrada_updated
  BEFORE UPDATE ON nf_entrada
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_nf_entrada_data_emissao ON nf_entrada(data_emissao ASC);
CREATE INDEX IF NOT EXISTS idx_nf_entrada_saldo ON nf_entrada(volume_saldo_kg);
CREATE INDEX IF NOT EXISTS idx_saida_romaneio ON saida(romaneio_microdata);
CREATE INDEX IF NOT EXISTS idx_alocacao_saida_id ON alocacao_saida(saida_id);

-- RLS (Row Level Security) - habilitar para produção
ALTER TABLE nf_entrada ENABLE ROW LEVEL SECURITY;
ALTER TABLE saida ENABLE ROW LEVEL SECURITY;
ALTER TABLE alocacao_saida ENABLE ROW LEVEL SECURITY;

-- Políticas permissivas (ajustar conforme autenticação)
CREATE POLICY "allow_all_nf_entrada" ON nf_entrada FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_saida" ON saida FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_alocacao" ON alocacao_saida FOR ALL USING (true) WITH CHECK (true);
