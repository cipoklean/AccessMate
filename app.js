import 'dotenv/config';
import { App, LogLevel } from '@slack/bolt';
import { registerAccessMateCommand } from './listeners/commands.js';
import { registerAltTextShortcut } from './listeners/altText.js';
import { registerSimplifyShortcut } from './listeners/simplify.js';
import { registerMentionHandler } from './listeners/mention.js';
import { registerAppHomeEvents } from './lib/appHome.js';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
  ignoreSelf: false,
});

registerAccessMateCommand(app);
registerAltTextShortcut(app);
registerSimplifyShortcut(app);
registerMentionHandler(app);
registerAppHomeEvents(app);

(async () => {
  await app.start();
  app.logger.info('AccessMate is running!');
})();