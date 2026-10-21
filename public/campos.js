// Campos do Módulo 1 do especialista e das Expedições do Agro.
// Usado pelo servidor (validação) e pelo navegador (formulário).
(function (raiz) {
  const comMax = (c) => (c.chave ? { max: 2000, ...c } : c);

  const MODULO1_ESPECIALISTA_CAMPOS = [
    { grupo: 'Itens que devem constar no Planejamento' },
    { chave: 'titulo', rotulo: 'Título do Projeto' },
    { chave: 'objetivo', rotulo: 'Objetivo', ajuda: 'Quais ações específicas serão realizadas para alcançar as metas?' },
    { chave: 'missao', rotulo: 'Missão' },
    { chave: 'visao', rotulo: 'Visão', ajuda: 'Onde o projeto pretende chegar? Qual o futuro almejado?' },
    { chave: 'valores', rotulo: 'Valores', ajuda: 'Quais princípios guiam o projeto? (Ex: sustentabilidade, ética, inovação...)' },
    { chave: 'metas', rotulo: 'Metas', ajuda: 'Quais resultados concretos e mensuráveis pretende atingir? (Ex: formar 30 jovens até dezembro)' },
    {
      chave: 'cronograma', rotulo: 'Cronograma dos 8 módulos', tabela: true,
      ajuda: 'Para cada módulo, informe a data ou o mês e descreva o que será trabalhado.',
      colunas: [
        { chave: 'data', rotulo: 'Data / mês', max: 60, exemplo: 'Ex: março/2026' },
        { chave: 'descricao', rotulo: 'O que será trabalhado', max: 500 },
      ],
    },
    {
      chave: 'orcamento', rotulo: 'Orçamento dos 8 módulos', tabela: true,
      ajuda: 'Para cada módulo, informe o que será gasto (materiais, insumos e demais custos) e o valor. O total geral é somado sozinho.',
      colunas: [
        { chave: 'descricao', rotulo: 'Materiais, insumos e custos', max: 500 },
        { chave: 'valor', rotulo: 'Valor (R$)', valor: true, exemplo: '0,00' },
      ],
    },
  ].map(comMax);

  // As 8 expedições têm os mesmos campos (e as fotos). As chaves são as que o módulo 1 usava,
  // para a expedição já enviada passar para a Expedição 1 sem mudar nada.
  const EXPEDICAO_CAMPOS = [
    { chave: 'expedicao_local', rotulo: 'Local', ajuda: 'Onde será realizada a expedição?', linha: true, max: 300 },
    { chave: 'expedicao_data', rotulo: 'Data', ajuda: 'Ex: 15/06/2025', linha: true, max: 50 },
    { chave: 'expedicao_objetivo', rotulo: 'Objetivo', ajuda: 'Qual o objetivo da expedição?' },
    { chave: 'expedicao_resultado', rotulo: 'Resultado', ajuda: 'Quais resultados foram (ou são esperados) com a expedição?' },
  ].map(comMax);

  // Lê um valor em reais escrito à brasileira ("1.234,56", "R$ 50") e devolve o número, ou null.
  function lerValor(v) {
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
    let s = String(v ?? '').replace(/R\$|\s/gi, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }

  function formatarReais(n) {
    return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  const exportar = { MODULO1_ESPECIALISTA_CAMPOS, EXPEDICAO_CAMPOS, lerValor, formatarReais };
  if (typeof module !== 'undefined') module.exports = exportar;
  else Object.assign(raiz, exportar);
})(this);
