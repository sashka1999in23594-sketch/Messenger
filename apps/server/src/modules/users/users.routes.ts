import type { FastifyInstance } from 'fastify';
import { changePhoneSchema, emailPrefsSchema, notificationSettingsSchema, pagination, pinPostSchema, privacySettingsSchema, profileLinksSchema, statusSchema, updateProfileSchema } from '@omni/shared';
import { parse } from '../../lib/errors.js';
import { requireAuth } from '../../http/request.js';

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  const { services } = app.ctx;

  app.get('/me', async (req) => services.users.me(requireAuth(req).userId));
  app.get('/me/counters', async (req) => services.notifications.counters(requireAuth(req).userId));

  app.patch('/me/profile', async (req) => {
    const auth = requireAuth(req);
    return services.users.updateProfile(auth.userId, parse(updateProfileSchema, req.body));
  });

  app.put('/me/phone', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const body = parse(changePhoneSchema, req.body);
    return services.users.changePhone(requireAuth(req).userId, body.phone, body.password);
  });
  app.put('/me/status', async (req) => services.users.setStatus(requireAuth(req).userId, parse(statusSchema, req.body)));
  app.delete('/me/status', async (req) => services.users.setStatus(requireAuth(req).userId, null));
  app.put('/me/links', async (req) => services.users.setLinks(requireAuth(req).userId, parse(profileLinksSchema, req.body).links));
  app.put('/me/pinned-post', async (req) => services.users.pinPost(requireAuth(req).userId, parse(pinPostSchema, req.body).postId));
  app.post<{ Params: { id: string } }>('/users/:id/subscribe', async (req) => {
    services.users.subscribe(requireAuth(req).userId, req.params.id, true);
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/users/:id/subscribe', async (req) => {
    services.users.subscribe(requireAuth(req).userId, req.params.id, false);
    return { ok: true };
  });

  app.patch('/me/privacy', async (req) => {
    const auth = requireAuth(req);
    return services.users.updatePrivacy(auth.userId, parse(privacySettingsSchema, req.body));
  });

  app.patch('/me/notification-settings', async (req) => {
    const auth = requireAuth(req);
    return services.users.updateNotificationPrefs(auth.userId, parse(notificationSettingsSchema, req.body));
  });

  app.patch('/me/email-prefs', async (req) => {
    const auth = requireAuth(req);
    return services.users.updateEmailPrefs(auth.userId, parse(emailPrefsSchema, req.body));
  });

  app.post('/me/onboarded', async (req) => {
    const auth = requireAuth(req);
    services.users.markOnboarded(auth.userId);
    return services.users.me(auth.userId);
  });

  app.get('/me/follow-requests', async (req) => ({ items: services.users.followRequests(requireAuth(req).userId) }));

  app.post<{ Params: { userId: string } }>('/me/follow-requests/:userId/accept', async (req) => {
    services.users.answerFollowRequest(requireAuth(req).userId, req.params.userId, true);
    return { ok: true };
  });

  app.post<{ Params: { userId: string } }>('/me/follow-requests/:userId/decline', async (req) => {
    services.users.answerFollowRequest(requireAuth(req).userId, req.params.userId, false);
    return { ok: true };
  });

  app.delete<{ Params: { userId: string } }>('/me/followers/:userId', async (req) => {
    services.users.removeFollower(requireAuth(req).userId, req.params.userId);
    return { ok: true };
  });

  app.get('/me/blocks', async (req) => ({ items: services.users.listRelations(requireAuth(req).userId, 'blocks') }));
  app.get('/me/mutes', async (req) => ({ items: services.users.listRelations(requireAuth(req).userId, 'mutes') }));

  app.get('/users/suggestions', async (req) => ({ items: services.users.suggestions(requireAuth(req).userId) }));

  app.get<{ Params: { idOrUsername: string } }>('/users/:idOrUsername', async (req) =>
    services.users.profile(requireAuth(req).userId, req.params.idOrUsername),
  );

  app.get<{ Params: { id: string } }>('/users/:id/followers', async (req) => {
    const q = parse(pagination, req.query);
    return services.users.followList(requireAuth(req).userId, req.params.id, 'followers', q.cursor, q.limit);
  });

  app.get<{ Params: { id: string } }>('/users/:id/following', async (req) => {
    const q = parse(pagination, req.query);
    return services.users.followList(requireAuth(req).userId, req.params.id, 'following', q.cursor, q.limit);
  });

  app.post<{ Params: { id: string } }>('/users/:id/follow', async (req) =>
    services.users.follow(requireAuth(req).userId, req.params.id),
  );

  app.delete<{ Params: { id: string } }>('/users/:id/follow', async (req) => {
    services.users.unfollow(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/users/:id/block', async (req) => {
    services.users.block(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/users/:id/block', async (req) => {
    services.users.unblock(requireAuth(req).userId, req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/users/:id/mute', async (req) => {
    services.users.mute(requireAuth(req).userId, req.params.id, true);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/users/:id/mute', async (req) => {
    services.users.mute(requireAuth(req).userId, req.params.id, false);
    return { ok: true };
  });
}
