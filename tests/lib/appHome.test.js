import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { publishAppHome, registerAppHomeEvents } from '../../lib/appHome.js';

describe('appHome.js', () => {
  describe('publishAppHome', () => {
    it('calls client.views.publish with correct user_id', async () => {
      let capturedUserId;
      const client = {
        views: {
          publish: async ({ user_id, view }) => {
            capturedUserId = user_id;
            assert.equal(view.type, 'home');
            assert.ok(Array.isArray(view.blocks));
            assert.ok(view.blocks.length > 5);
            return { ok: true };
          },
        },
      };
      await publishAppHome({ userId: 'U123', client, logger: { error: () => {} } });
      assert.equal(capturedUserId, 'U123');
    });

    it('logs error when publish fails', async () => {
      let logged = false;
      const client = {
        views: {
          publish: async () => {
            throw new Error('rate_limited');
          },
        },
      };
      const logger = {
        error: () => {
          logged = true;
        },
      };
      // Should not throw — error is caught and logged
      await publishAppHome({ userId: 'U123', client, logger });
      assert.ok(logged);
    });

    it('handles missing logger gracefully', async () => {
      const client = {
        views: {
          publish: async () => {
            throw new Error('fail');
          },
        },
      };
      // Should not throw even without a logger
      await publishAppHome({ userId: 'U123', client });
    });

    it('home view contains all feature sections', async () => {
      let capturedView;
      const client = {
        views: {
          publish: async ({ view }) => {
            capturedView = view;
            return { ok: true };
          },
        },
      };
      await publishAppHome({ userId: 'U123', client, logger: { error: () => {} } });
      const allText = JSON.stringify(capturedView);
      assert.ok(allText.includes('Alt text'));
      assert.ok(allText.includes('Simplify thread'));
      assert.ok(allText.includes('Weekly digest'));
      assert.ok(allText.includes('accessmate'));
    });
  });

  describe('registerAppHomeEvents', () => {
    it('registers app_home_opened event handler', () => {
      let registeredEvent = null;
      const fakeApp = {
        event: (name, handler) => {
          registeredEvent = { name, handler };
        },
      };
      registerAppHomeEvents(fakeApp);
      assert.equal(registeredEvent.name, 'app_home_opened');
      assert.equal(typeof registeredEvent.handler, 'function');
    });

    it('ignores non-home tabs', async () => {
      let publishCalled = false;
      const fakeApp = {
        event: (name, handler) => {
          this._handler = handler;
        },
      };
      let capturedHandler;
      fakeApp.event = (name, handler) => {
        capturedHandler = handler;
      };
      registerAppHomeEvents(fakeApp);

      const client = {
        views: {
          publish: async () => {
            publishCalled = true;
            return { ok: true };
          },
        },
      };
      // 'messages' tab should be ignored
      await capturedHandler({
        event: { tab: 'messages', user: 'U123' },
        client,
        logger: { error: () => {} },
      });
      assert.equal(publishCalled, false);
    });

    it('publishes home view when home tab is opened', async () => {
      let publishCalled = false;
      let capturedUserId = null;
      const fakeApp = {};
      let capturedHandler;
      fakeApp.event = (name, handler) => {
        capturedHandler = handler;
      };
      registerAppHomeEvents(fakeApp);

      const client = {
        views: {
          publish: async ({ user_id }) => {
            publishCalled = true;
            capturedUserId = user_id;
            return { ok: true };
          },
        },
      };
      await capturedHandler({
        event: { tab: 'home', user: 'U456' },
        client,
        logger: { error: () => {} },
      });
      assert.ok(publishCalled);
      assert.equal(capturedUserId, 'U456');
    });
  });
});
