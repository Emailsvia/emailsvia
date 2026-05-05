/**
 * Card UI for the EmailsVia sidebar. Two states:
 *   - no API key on file → "Connect" form with a paste field
 *   - key present → "Send mail merge" form with name/subject/template
 */
function buildHomeCard() {
  const key = PropertiesService.getUserProperties().getProperty('EMAILSVIA_KEY');
  return key ? buildSendCard(key) : buildConnectCard();
}

function buildConnectCard() {
  const header = CardService.newCardHeader()
    .setTitle('EmailsVia')
    .setSubtitle('Connect your account');

  const intro = CardService.newTextParagraph().setText(
    'Paste an API key from <a href="https://emailsvia.com/app/keys">emailsvia.com/app/keys</a>. ' +
      'The key is stored only in your Google account properties — we never see it.'
  );

  const input = CardService.newTextInput()
    .setFieldName('api_key')
    .setTitle('API key')
    .setHint('eav_live_…');

  const submit = CardService.newTextButton()
    .setText('Save')
    .setOnClickAction(CardService.newAction().setFunctionName('saveApiKey'));

  const section = CardService.newCardSection()
    .addWidget(intro)
    .addWidget(input)
    .addWidget(CardService.newButtonSet().addButton(submit));

  return CardService.newCardBuilder().setHeader(header).addSection(section).build();
}

function buildSendCard(_key) {
  const header = CardService.newCardHeader()
    .setTitle('EmailsVia')
    .setSubtitle('Send mail merge from this sheet');

  const help = CardService.newTextParagraph().setText(
    'Headers in row 1 become merge tags: <b>email</b> (required), <b>name</b>, <b>company</b>, ' +
      'plus any other column you add (e.g. <b>Role</b> → <b>{{Role}}</b>).'
  );

  const nameInput = CardService.newTextInput()
    .setFieldName('campaign_name')
    .setTitle('Campaign name')
    .setHint('Q2 outreach — sheet import');

  const subjectInput = CardService.newTextInput()
    .setFieldName('subject')
    .setTitle('Subject')
    .setHint('Quick question, {{Name}}');

  const templateInput = CardService.newTextInput()
    .setFieldName('template')
    .setTitle('Message')
    .setMultiline(true)
    .setHint('Hi {{Name}},\n\n…');

  const submit = CardService.newTextButton()
    .setText('Create campaign')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('sendMerge'));

  const clearKey = CardService.newTextButton()
    .setText('Disconnect')
    .setOnClickAction(CardService.newAction().setFunctionName('clearApiKey'));

  const section = CardService.newCardSection()
    .addWidget(help)
    .addWidget(nameInput)
    .addWidget(subjectInput)
    .addWidget(templateInput)
    .addWidget(CardService.newButtonSet().addButton(submit).addButton(clearKey));

  const note = CardService.newCardSection()
    .setHeader('Note')
    .addWidget(
      CardService.newTextParagraph().setText(
        'The campaign is created as a <b>draft</b>. Open the EmailsVia dashboard to pick a sender, ' +
          'tweak follow-ups, and hit "Run" when you\'re ready.'
      )
    );

  return CardService.newCardBuilder()
    .setHeader(header)
    .addSection(section)
    .addSection(note)
    .build();
}
