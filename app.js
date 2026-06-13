import 'dotenv/config';
import { App, LogLevel } from '@slack/bolt';
import { registerAccessMateCommand } from './listeners/commands.js';
import { registerAltTextShortcut } from './listeners/altText.js';
import { registerSimplifyShortcut } from './listeners/simplify.js';
import { registerMentionHandler } from './listeners/mention.js';
import { registerAppHomeEvents } from './lib/appHome.js';
import http from 'node:http';

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

// Adding a keep-alive HTTP endpoint for Render free tier
// UptimeRobot pings /health every 5 min so Render never spins this service down
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
	if (req.url === '/health') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('AccessMate is awake');
		return;
	}
	res.writeHead(404, { 'Content-Type': 'text/plain' });
	res.end('Not found');
}).listen(PORT, () => {
	console.log(`💓 Keep-alive HTTP listening on :${PORT}`);
});