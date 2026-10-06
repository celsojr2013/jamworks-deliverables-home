# Jamworks — Planejador de entregáveis

Home estática para analisar planilhas de mídia com n8n, revisar sugestões e criar a lista inicial de entregáveis de um Job.

## Configuração

Informe a URL HTTPS completa de envio no parâmetro `job_processor_endpoint` da Home, codificada com `encodeURIComponent`. Opcionalmente, informe `job_processor_status_endpoint`. Os endereços também podem ser preenchidos na seção **Configuração técnica** ou receber valores padrão em `config.js`.

Contrato do processador:

- POST no endereço completo configurado: recebe `{job_id, spreadsheet_node_id}` com header `token`; retorna `analysis_id` e, opcionalmente, `status_url`/`poll_url` e `poll_after_ms`.
- GET de acompanhamento: retorna `status` e, ao concluir, `result.deliverables`. Não recebe token. A URL é escolhida nesta ordem: `job_processor_status_endpoint`, `status_url`/`poll_url` da resposta ou, para um envio terminado em `/submit`, o caminho irmão `/status`. O app acrescenta `analysis_id` à consulta. Envio e acompanhamento precisam ter a mesma origem HTTPS.

Exemplo sem credenciais reais:

```text
https://celsojr2013.github.io/jamworks-deliverables-home/?job_processor_endpoint=https%3A%2F%2Fn8n.exemplo.com%2Fwebhook%2Fjw2-deliverables%2Fsubmit#token=<TOKEN_DA_SESSAO>
```

O app solicita confirmação do destino antes de encaminhar o token para um processador ainda não autorizado na sessão. Origens confiáveis podem ser cadastradas em `allowedProcessorOrigins` no arquivo `config.js` (não por parâmetro na URL). Redirecionamentos do processador são bloqueados. O token só é enviado no POST de análise e para as APIs Jamworks fixas da aplicação.

Os endpoints precisam aceitar chamadas CORS da origem publicada, inclusive o preflight com os headers `token` e `Content-Type`. A versão publicada não usa localhost como serviço de análise.

## Sessão

A Home recebe o token do usuário Jamworks em `#token=...` (preferível) ou `?token=...`. O app remove esse valor da URL e o mantém somente em memória. Tokens em query string podem aparecer nos registros do servidor que hospeda a página; prefira o fragmento quando a integração permitir.

Job e planilha são sempre escolhidos na interface: `job_id`, `node_id` e `spreadsheet_node_id` na URL não pré-preenchem campos nem disparam chamadas. Não inclua credenciais ou tokens em commits, em `config.js` ou em links compartilhados. Não há login de testes ou credencial embutida nesta distribuição. Todas as operações de dados dependem da identidade atual e das permissões aplicadas pelas APIs Jamworks.

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
