# Jamworks — Planejador de entregáveis

Home estática para analisar planilhas de mídia com n8n, revisar sugestões e criar a lista inicial de entregáveis de um Job.

## Configuração

Defina a URL HTTPS pública da base dos webhooks em `config.js`. Ela também pode ser informada na seção **Configuração técnica** ou pelo parâmetro `n8n_base` da Home.

Rotas esperadas, relativas à base configurada:

- `POST jw2-deliverables/submit`: recebe `{job_id, spreadsheet_node_id}` com header `token`; retorna `analysis_id`.
- `GET jw2-deliverables/status?analysis_id=...`: retorna status e, ao concluir, `result.deliverables`.

Os endpoints precisam aceitar chamadas CORS da origem publicada, inclusive o preflight com os headers `token` e `Content-Type`. A versão publicada não usa localhost como serviço de análise.

## Sessão

A Home recebe o token do usuário Jamworks em `#token=...` (preferível) ou `?token=...`. O app remove esse valor da URL e o mantém somente em memória. Tokens em query string podem aparecer nos registros do servidor que hospeda a página; prefira o fragmento quando a integração permitir.

Parâmetros opcionais: `job_id`, `spreadsheet_node_id` e `n8n_base`. Não inclua credenciais ou tokens em commits, em `config.js` ou em links compartilhados. Não há login de testes ou credencial embutida nesta distribuição. Todas as operações de dados dependem da identidade atual e das permissões aplicadas pelas APIs Jamworks.

## Fluxo

1. Carregar o Job e selecionar uma planilha da pasta ou das referências vinculadas.
2. Solicitar análise e acompanhar o processamento.
3. Revisar títulos, tipos do catálogo, dimensões e specs.
4. Confirmar a gravação em um Job sem entregáveis existentes.

`format` contém as dimensões e `spec` é usado integralmente como título do formato, sem concatenação automática. Campos maiores que 255 caracteres precisam de revisão; não há truncamento silencioso.

Um único batch é enviado. Leituras a cada 5 segundos atualizam contagens e progresso, e o sucesso exige comparação dos dados gravados. Falhas de conexão não provocam reenvio. Parar o acompanhamento não cancela a gravação no servidor. Mantenha a aba aberta: rascunhos e estado de acompanhamento não são persistidos após recarregar.

## Publicação

GitHub Pages: branch `main`, diretório raiz. O arquivo `.nojekyll` mantém a publicação estática. Sem instalação de dependências ou build. Atualizações são publicadas após push para `main`.

O site e os arquivos JavaScript distribuídos são públicos. Não colocar dados privados na distribuição, mesmo que o repositório de origem seja privado.

Fontes e logotipo são carregados dos provedores usados pelo Jamworks. Este utilitário não faz upload de planilhas; usa arquivos já disponíveis no Jamworks.
