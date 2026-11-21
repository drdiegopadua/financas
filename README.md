# Minhas Finanças

PWA de controle financeiro pessoal.

- **Despesas**: pagamento único, parcelado (informe o total ou o valor da parcela) ou fixa mensal, com tipo de despesa (Moradia, Mercado, Saúde, Cartão… e tipos personalizados)
- **A receber**: valores que outras pessoas te devem, com previsão e marcação de recebido
- **Entradas**: salário e outras rendas (únicas ou mensais)
- **Painel**: quanto está sobrando no mês, pago × a pagar, gastos por tipo, parcelas futuras e projeção dos próximos 6 meses
- Backup/restauração em JSON. Os dados ficam salvos no aparelho (localStorage) e, se você quiser, numa **planilha sua do Google Planilhas**.

## Google Planilhas como banco de dados

O arquivo [`apps-script.gs`](apps-script.gs) é colado em Extensões → Apps Script da sua planilha e publicado como "App da Web". O app conversa com ele por POST, usando uma chave secreta.
Abas criadas automaticamente: `Despesas`, `Entradas`, `AReceber`, `Tipos`, `Config`. Dá para incluir linhas direto na planilha: elas aparecem no app na próxima sincronização.
O passo a passo está no app, em **Ajustes → Google Planilhas**.

Acesse: https://drdiegopadua.github.io/financas/
