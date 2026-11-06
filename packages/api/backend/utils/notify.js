// Notification Utility — routes notifications to the server's in-app system
// The `pool` and `io` (socket) refs are injected at startup via init()

let _pool = null;
let _io = null;

function init({ pool, io } = {}) {
  _pool = pool || null;
  _io = io || null;
}

async function notifyUser(userId, message, type = 'info') {
  console.log(`[Notify] user=${userId} type=${type}: ${message}`);
  if (!_pool || !userId) return;
  try {
    await _pool.query(
      `INSERT INTO notifications (id, user_id, type, message, read, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())
       ON CONFLICT DO NOTHING`,
      [userId, type, message]
    );
  } catch {
    // Notifications table may not exist in all environments — fail silently
  }
  // Push real-time alert if Socket.IO is available
  _io?.to(`user:${userId}`)?.emit('notification', { type, message });
}

async function notifyAdmin(message, type = 'warning') {
  console.log(`[Notify] admin type=${type}: ${message}`);
  if (!_pool) return;
  try {
    await _pool.query(
      `INSERT INTO notifications (id, user_id, type, message, read, created_at)
       VALUES (gen_random_uuid(), 'admin', $1, $2, false, NOW())
       ON CONFLICT DO NOTHING`,
      [type, message]
    );
  } catch {
    // Fail silently
  }
  _io?.to('admin')?.emit('notification', { type, message });
}

// Notify user their token needs re-approval (called by token health monitor)
async function notifyTokenExpiring(userId, platformName) {
  const message = `Your ${platformName} connection needs a quick re-approval to keep your schedule running smoothly.`;
  await notifyUser(userId, message, 'warning');
}

// Notify user a post permanently failed
async function notifyPostFailed(userId, platformName, error) {
  const message = `Your ${platformName} post failed and will not be retried: ${error}`;
  await notifyUser(userId, message, 'error');
}

module.exports = { init, notifyUser, notifyAdmin, notifyTokenExpiring, notifyPostFailed };
