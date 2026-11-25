# Rifa São Francisco: publicação, PIX e notificações por WhatsApp

## 1. Regras do Firestore (obrigatório, antes de publicar o site)

O site novo usa as coleções `rifa_sao_francisco` (números), `rifa_sao_francisco_pedidos`
(pedidos), `rifa_sao_francisco_notificacoes` (histórico de WhatsApp) e `rifa_config`.
As regras atuais do projeto não liberam essas coleções: sem este passo, a página não carrega
os números.

1. Console do Firebase > projeto **rifa-escola** > Firestore Database > **Regras**.
2. Copie o conteúdo de `firestore.rules`, cole e clique em **Publicar**.
   (Ou, com a Firebase CLI: `firebase deploy --only firestore:rules`.)
3. Em Authentication, deixe somente contas de administrador. Qualquer usuário logado
   é tratado como admin pelas regras.

Se mudar `RESERVATION_MINUTES` para mais de 24 h, ajuste o limite `duration.value(25, 'h')`
nas regras. Se mudar `PRICE_PER_NUMBER`, ajuste `valorUnitario == 15` nas regras.

## 2. PIX

- Chave (telefone): `+5561992611326`. Titular: `ARTUR H G NASCIMENTO`. Cidade: `BRASILIA`.
  Tudo em `firebase-config.js`.
- Cada pedido gera um PIX "copia e cola" e um QR Code com o **valor exato** e um
  **txid** igual ao código do pedido.
- A confirmação é **manual**: o admin confere o extrato e clica em **Confirmar pagamento**.
- Baixa automática exige um gateway (Mercado Pago, Efí etc.) e um backend com credenciais.
  O ponto de integração está em `payment-provider.js`.

## 3. Notificações por WhatsApp (Cloud Functions + WhatsApp Cloud API da Meta)

O backend fica em `functions/`. Ele envia avisos mesmo com o painel fechado:

| Evento | Gatilho |
| --- | --- |
| Nova compra | pedido criado |
| Pagamento confirmado | pedido muda para `pago` |
| Compra cancelada | pedido muda para `cancelado` |
| Reserva expirada | pedido muda para `expirado` (a função agendada expira a cada 5 min) |
| Reserva perto de expirar | função agendada, faltando até 15 min |

Cada aviso é registrado em `rifa_sao_francisco_notificacoes`, com ID `pedido_tipo`.
Isso impede envio duplicado. Um envio com erro pode ser refeito.

### 3.1 O que você precisa

1. **Plano Blaze** no Firebase. Cloud Functions não roda no plano gratuito. O uso desta rifa
   tende a ficar dentro da cota gratuita do Blaze, mas é preciso um cartão cadastrado.
2. **Conta Meta Business** e um app no [Meta for Developers](https://developers.facebook.com/)
   com o produto **WhatsApp**.
3. **Um número de WhatsApp para o "remetente"**. Precisa ser um número que **não** esteja em
   uso no app WhatsApp comum. O número de teste que a Meta fornece serve para começar.
   O destino (`+55 61 99261-1326`) é quem **recebe** e pode continuar no WhatsApp normal.
4. Na tela do app Meta > WhatsApp > Configuração da API:
   - **Phone number ID** do remetente.
   - **Token permanente**: crie um *System User* no Business Manager com permissão
     `whatsapp_business_messaging`. O token temporário vence em 24 h.
   - Com o número de teste, adicione `+55 61 99261-1326` como destinatário autorizado.

### 3.2 Templates (obrigatórios no modo padrão)

Mensagens iniciadas pela empresa só podem ser enviadas por **template aprovado** pela Meta.
Texto livre só funciona até 24 h depois que o destinatário mandar mensagem para o número
remetente. Crie estes templates em WhatsApp Manager > Modelos de mensagem, categoria
**Utilidade**, idioma **Português (BR)**, com o corpo abaixo:

**rifa_nova_compra**
```
🔔 *NOVA COMPRA NA RIFA!*

👤 Participante: {{1}}
📱 Telefone: {{2}}
🎟️ Números escolhidos: {{3}}
🔢 Quantidade: {{4}}
💰 Valor total: {{5}}
💳 Pagamento: Aguardando PIX

📅 Data: {{6}}
⏰ Horário: {{7}}

Acesse o painel administrativo para acompanhar o pedido.
```

**rifa_pagamento_confirmado**
```
✅ *PAGAMENTO CONFIRMADO!*

O participante {{1}} realizou o pagamento da rifa.

🎟️ Números: {{2}}
💰 Valor recebido: {{3}}
💳 Status: PAGO

Os números foram atualizados para vendidos.
```

**rifa_reserva_expirando**
```
⏳ *RESERVA PERTO DE EXPIRAR*

A reserva de {{1}} ainda não foi paga.
🎟️ Números: {{2}}
💰 Valor: {{3}}
⏰ Expira às: {{4}}
```

**rifa_reserva_expirada**
```
⌛ *RESERVA EXPIRADA*

O prazo de pagamento de {{1}} terminou.
🎟️ Números liberados: {{2}}
```

**rifa_compra_cancelada**
```
❌ *COMPRA CANCELADA*

O pedido de {{1}} foi cancelado.
🎟️ Números liberados: {{2}}
💰 Valor: {{3}}
```

O botão **Enviar mensagem de teste** do painel usa o template `hello_world`, que a Meta
já cria em toda conta nova.

### 3.3 Publicar o backend

```bash
npm install -g firebase-tools          # se ainda não tiver
firebase login
cd functions && npm install && cd ..

# Credenciais: ficam no Secret Manager do Google, nunca no site
firebase functions:secrets:set WHATSAPP_TOKEN
firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID

firebase deploy --only functions
```

Durante o deploy, a CLI pergunta `WHATSAPP_MODE` (deixe `template`) e
`WHATSAPP_TEMPLATE_LANG` (deixe `pt_BR`).

A região está em `functions/index.js` (`us-central1`) e em `admin.js` (`FUNCTIONS_REGION`).
Se o banco Firestore estiver em outra região (veja em Firestore > Dados), use a mesma nos dois.

### 3.4 Conferir

1. Painel do admin > **Notificações**: confira o WhatsApp de destino e clique em
   **Enviar mensagem de teste**.
2. Faça uma compra de teste na página da rifa. Em seguida, o histórico deve mostrar
   **Nova compra / enviado**.
3. Em caso de **erro**, o histórico mostra a resposta da Meta. Causas comuns: template
   ainda não aprovado, token expirado ou destinatário não autorizado no número de teste.

## 4. Testes locais

```bash
node --test tests/*.mjs        # PIX (CRC do manual do BR Code), contadores e expiração
cd functions && npm test       # textos das notificações e validação de telefone
```

Para o emulador do Firebase (`firebase emulators:start`), é preciso Java 21 ou mais recente.
Depois abra `http://localhost:PORTA/index.html?emulador`.
