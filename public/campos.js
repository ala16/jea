// Campos do Módulo 1 do especialista. Usado pelo servidor (validação) e pelo navegador (formulário).
(function (raiz) {
  const MODULO1_ESPECIALISTA_CAMPOS = [
    { grupo: 'Itens que devem constar no Planejamento' },
    { chave: 'titulo', rotulo: 'Título do Projeto' },
    { chave: 'missao', rotulo: 'Missão' },
    { chave: 'visao', rotulo: 'Visão', ajuda: 'Onde o projeto pretende chegar? Qual o futuro almejado?' },
    { chave: 'valores', rotulo: 'Valores', ajuda: 'Quais princípios guiam o projeto? (Ex: sustentabilidade, ética, inovação...)' },
    { chave: 'metas', rotulo: 'Metas', ajuda: 'Quais resultados concretos e mensuráveis pretende atingir? (Ex: formar 30 jovens até dezembro)' },
    { chave: 'objetivo', rotulo: 'Objetivo', ajuda: 'Quais ações específicas serão realizadas para alcançar as metas?' },
    { chave: 'cronograma', rotulo: 'Cronograma dos 8 módulos', ajuda: 'Detalhe as datas e atividades previstas para cada um dos 8 módulos do Programa.' },
    { chave: 'orcamento', rotulo: 'Orçamento dos 8 módulos', ajuda: 'Detalhe o orçamento previsto para os 8 módulos do Programa: materiais, insumos, e demais custos. Apresente os valores por módulo e o total geral.' },
    { grupo: 'Expedição do Agro', ajuda: 'Registre os detalhes da expedição realizada pela turma.' },
    { chave: 'expedicao_local', rotulo: 'Local', ajuda: 'Onde será realizada a expedição?', linha: true, max: 300 },
    { chave: 'expedicao_data', rotulo: 'Data', ajuda: 'Ex: 15/06/2025', linha: true, max: 50 },
    { chave: 'expedicao_objetivo', rotulo: 'Objetivo', ajuda: 'Qual o objetivo da expedição?' },
    { chave: 'expedicao_resultado', rotulo: 'Resultado', ajuda: 'Quais resultados foram (ou são esperados) com a expedição?' },
  ].map((c) => (c.chave ? { max: 2000, ...c } : c));

  if (typeof module !== 'undefined') module.exports = { MODULO1_ESPECIALISTA_CAMPOS };
  else raiz.MODULO1_ESPECIALISTA_CAMPOS = MODULO1_ESPECIALISTA_CAMPOS;
})(this);
