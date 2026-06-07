import 'dotenv/config';
import { registerAccessMateCommand } from './listeners/commands.js';
import { registerAltTextShortcut } from './listeners/altText.js';
import { registerSimplifyShortcut } from './listeners/simplify.js';
import { App, LogLevel } from '@slack/bolt';
//import { registerListeners } from './listeners/index.js';
import { registerMentionHandler } from './listeners/mention.js';
import { registerDigestCron } from './listeners/digest.js';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
  ignoreSelf: false,
});

registerAccessMateCommand(app);
//registerListeners(app);
registerAltTextShortcut(app);
registerSimplifyShortcut(app);
registerMentionHandler(app);
registerDigestCron(app);

(async () => {
  await app.start();
  app.logger.info('Casey is running!');
})();
